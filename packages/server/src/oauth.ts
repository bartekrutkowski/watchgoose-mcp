import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import Provider, {
  errors,
  type Client,
  type Configuration,
  type Interaction,
  type InteractionResults,
} from "oidc-provider";
import type { ServerConfig } from "./config.js";
import {
  ACCESS_TOKEN_TTL,
  ALLOWED_SCOPES,
  AUTHORIZATION_CODE_TTL,
  MAX_GRANT_LIFETIME,
  MAX_HANDOFF_RESPONSE_BYTES,
  MCP_SCOPES,
  REFRESH_TOKEN_TTL,
  TRANSIENT_TTL,
} from "./constants.js";
import { deriveCookieKeys, deriveSigningJwk, opaqueAccountId, signCookie } from "./crypto.js";
import type { PendingRecord, SqliteState, StoredCredential } from "./database.js";
import { safeLabel, type Logger } from "./logger.js";
import { validRequestedScopes } from "./security.js";

interface HandoffConnection {
  id: number;
  user_id: number;
  project_id: number;
  client_id: string;
  client_name: string;
  scope: "read" | "read+write";
}

interface HandoffResult {
  api_key: string;
  connection: HandoffConnection;
}

export interface OAuthService {
  provider: Provider;
  callback: ReturnType<Provider["callback"]>;
  handleInteraction(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
}

const MAX_OAUTH_STATE_LENGTH = 2_048;
const MAX_TRACKED_FLOWS = 1_000;

// A failure with a fixed, loggable reason category.
class FlowError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

type HandoffFailure = "network" | "http_status" | "too_large" | "invalid_response";

class HandoffExchangeError extends Error {
  constructor(
    readonly reason: HandoffFailure,
    readonly status?: number
  ) {
    super("handoff exchange failed");
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char
  );
}

const FLOW_PAGES = {
  expired: {
    status: 400,
    title: "This connection request has expired",
    lead: "This link has expired or was already used. If you approved the connection a moment ago, go back to your AI assistant: it is probably already connected. Otherwise nothing was connected to your Watchgoose account.",
  },
  failed: {
    status: 500,
    title: "Connection failed",
    lead: "Something went wrong and the connection could not be completed, so nothing was connected to your Watchgoose account.",
  },
} as const;

// A self-contained page for a connection that cannot continue. It never
// redirects back to the client: once the pending state is consumed or gone,
// there is no trustworthy client and state to send the browser to.
function sendFlowPage(res: ServerResponse, kind: keyof typeof FLOW_PAGES, docsUrl: string): void {
  const page = FLOW_PAGES[kind];
  const title = escapeHtml(page.title);
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
body{margin:0;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f7f9;color:#1d2330}
main{max-width:34rem;margin:12vh auto;padding:2rem;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:1.4rem;line-height:1.3;margin:0 0 1rem}
p{margin:0 0 1rem}
a{color:#1f5fbf}
@media (prefers-color-scheme:dark){body{background:#14171c;color:#e6e8eb}main{background:#1d2128;box-shadow:none}a{color:#7fb0ff}}
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${escapeHtml(page.lead)}</p>
<p>${escapeHtml("To connect, go back to your AI assistant (Claude, ChatGPT, Codex or another app) and start connecting Watchgoose again. It usually takes under a minute.")}</p>
<p><a href="${escapeHtml(docsUrl)}">${escapeHtml("Read the Watchgoose MCP setup guide")}</a></p>
</main>
</body>
</html>
`;
  res.statusCode = page.status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  res.end(body);
}

function stringParam(interaction: Interaction, name: string): string | undefined {
  const value = interaction.params[name];
  return typeof value === "string" ? value : undefined;
}

function validateAuthorizationInteraction(interaction: Interaction, resource: string): void {
  if (interaction.params.resource !== resource) {
    throw new errors.InvalidTarget();
  }
  const challenge = stringParam(interaction, "code_challenge");
  const clientId = stringParam(interaction, "client_id");
  const clientState = stringParam(interaction, "state");
  if (
    stringParam(interaction, "response_type") !== "code" ||
    !clientId ||
    clientId.length > 200 ||
    !clientState ||
    clientState.length > MAX_OAUTH_STATE_LENGTH ||
    stringParam(interaction, "code_challenge_method") !== "S256" ||
    !challenge ||
    challenge.length < 43 ||
    challenge.length > 128 ||
    !validRequestedScopes(stringParam(interaction, "scope"))
  ) {
    throw new errors.InvalidRequest("authorization request does not satisfy server policy");
  }
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function parseHandoff(value: unknown): HandoffResult {
  if (typeof value !== "object" || value === null) throw new Error("invalid handoff response");
  const candidate = value as Record<string, unknown>;
  if (!exactKeys(candidate, ["api_key", "connection"])) throw new Error("invalid handoff response");
  const connection = candidate.connection;
  if (typeof connection !== "object" || connection === null) {
    throw new Error("invalid handoff response");
  }
  const item = connection as Record<string, unknown>;
  if (
    !exactKeys(item, ["client_id", "client_name", "id", "project_id", "scope", "user_id"]) ||
    typeof candidate.api_key !== "string" ||
    !/^hcm_[A-Za-z0-9]{28}$/.test(candidate.api_key) ||
    !Number.isSafeInteger(item.id) ||
    !Number.isSafeInteger(item.user_id) ||
    !Number.isSafeInteger(item.project_id) ||
    (item.id as number) < 1 ||
    (item.user_id as number) < 1 ||
    (item.project_id as number) < 1 ||
    typeof item.client_id !== "string" ||
    typeof item.client_name !== "string" ||
    (item.scope !== "read" && item.scope !== "read+write")
  ) {
    throw new Error("invalid handoff response");
  }
  return candidate as unknown as HandoffResult;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_HANDOFF_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new HandoffExchangeError("too_large");
  }
  if (!response.body) throw new HandoffExchangeError("invalid_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_HANDOFF_RESPONSE_BYTES) {
      await reader.cancel();
      throw new HandoffExchangeError("too_large");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HandoffExchangeError("invalid_response");
  }
}

async function exchangeHandoff(
  code: string,
  config: ServerConfig,
  correlationId?: string
): Promise<HandoffResult> {
  let response: Response;
  try {
    response = await config.fetch(config.handoffUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.workerSecret}`,
        "Content-Type": "application/json",
        ...(correlationId ? { "X-Correlation-ID": correlationId } : {}),
      },
      body: JSON.stringify({ code }),
      redirect: "error",
    });
  } catch {
    throw new HandoffExchangeError("network");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HandoffExchangeError("http_status", response.status);
  }
  const body = await readBoundedJson(response);
  try {
    return parseHandoff(body);
  } catch {
    throw new HandoffExchangeError("invalid_response");
  }
}

function appendResumeCookie(
  req: IncomingMessage,
  provider: Provider,
  uid: string,
  cookieKey: string
): void {
  const name = provider.cookieName("resume");
  const pair = `${name}=${uid}`;
  const signature = `${name}.sig=${signCookie(name, uid, cookieKey)}`;
  req.headers.cookie = [req.headers.cookie, pair, signature].filter(Boolean).join("; ");
}

function validateBinding(
  interaction: Interaction,
  client: Client,
  handoff: HandoffResult
): StoredCredential & { scopes: string[] } {
  const requested = stringParam(interaction, "scope")?.split(" ") ?? [];
  const connection = handoff.connection;
  if (
    connection.client_id !== client.clientId ||
    connection.client_name !== client.clientName ||
    (connection.scope === "read+write" && !requested.includes("mcp:write"))
  ) {
    throw new Error("handoff binding mismatch");
  }
  const scopes = ["mcp:read"];
  if (connection.scope === "read+write") scopes.push("mcp:write");
  if (requested.includes("offline_access")) scopes.push("offline_access");
  return {
    apiKey: handoff.api_key,
    access: connection.scope === "read+write" ? "read-write" : "read-only",
    scopes,
  };
}

// The absolute Unix time (integer seconds) after which this authorization can
// no longer complete: the earlier of the pending state's and the provider
// Interaction's expiry. Django uses it as an upper bound for its own
// transaction deadline.
function deadline(pending: PendingRecord, interaction: Interaction): number {
  const interactionExpiry =
    typeof interaction.exp === "number" ? interaction.exp : Number.POSITIVE_INFINITY;
  return Math.floor(Math.min(pending.expiresAt, interactionExpiry));
}

const PROVIDER_ERROR_EVENTS = [
  "server_error",
  "authorization.error",
  "grant.error",
  "registration_create.error",
  "backchannel.error",
] as const;

// Provider events carry the request context and the error. Only the error's
// class name, OAuth error code and short description are logged; never the
// context, tokens, parameters or error_detail.
function subscribeProviderEvents(provider: Provider, logger: Logger): void {
  // The typed overloads cover each event separately; the payloads used here
  // are checked at runtime instead.
  const events = provider as unknown as EventEmitter;
  for (const name of PROVIDER_ERROR_EVENTS) {
    events.on(name, (ctx: unknown, error: unknown) => {
      const err = (typeof error === "object" && error !== null ? error : {}) as Record<
        string,
        unknown
      >;
      const oidc = (ctx as { oidc?: { client?: { clientName?: unknown } } } | undefined)?.oidc;
      logger.setClientName(oidc?.client?.clientName);
      logger.write(name === "server_error" ? "error" : "warn", "oidc_error", {
        oidc_event: name,
        error_name: safeLabel(err.name, 60),
        error: safeLabel(err.error, 60),
        error_description: safeLabel(err.error_description, 200),
        client_name: logger.clientName(),
      });
    });
  }
  events.on("refresh_token.consumed", () => {
    logger.info("oidc_refresh_token_consumed");
  });
  events.on("grant.revoked", (_ctx: unknown, grantId: unknown) => {
    logger.warn("oidc_grant_revoked", {
      grant_ref: typeof grantId === "string" ? logger.ref(grantId) : undefined,
    });
  });
}

export function createOAuthService(
  config: ServerConfig,
  state: SqliteState,
  logger: Logger
): OAuthService {
  const cookieKeys = deriveCookieKeys(config.encryptionKey);
  // Grant id to interaction start, kept only until the authorization code is
  // exchanged, so oauth_grant_issued can report the whole flow duration.
  const flowStarts = new Map<string, number>();
  const configuration: Configuration = {
    adapter: (name) => state.adapter(name),
    clients: [],
    clientAuthMethods: ["none"],
    clientDefaults: {
      application_type: "native",
      grant_types: ["authorization_code", "refresh_token"],
      id_token_signed_response_alg: "EdDSA",
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    cookies: {
      keys: cookieKeys,
      names: {
        session: "__Host-wg_session",
        interaction: "__Host-wg_interaction",
        // The provider scopes this cookie to /authorize/<uid>, so __Host-
        // would be rejected by browsers because it requires Path=/.
        resume: "__Secure-wg_resume",
      },
      long: { httpOnly: true, path: "/", sameSite: "lax", secure: true },
      short: { httpOnly: true, path: "/", sameSite: "lax", secure: true },
    },
    features: {
      devInteractions: { enabled: false },
      dPoP: { enabled: false },
      introspection: { enabled: false },
      registration: { enabled: true, issueRegistrationAccessToken: false },
      registrationManagement: { enabled: false },
      resourceIndicators: {
        enabled: true,
        defaultResource(_ctx, _client, oneOf) {
          if (oneOf) return oneOf;
          throw new errors.InvalidTarget();
        },
        useGrantedResource: () => true,
        getResourceServerInfo(_ctx, resource) {
          if (resource !== config.resource) throw new errors.InvalidTarget();
          return {
            scope: MCP_SCOPES.join(" "),
            audience: config.resource,
            accessTokenTTL: ACCESS_TOKEN_TTL,
            accessTokenFormat: "opaque",
          };
        },
      },
      revocation: { enabled: false },
      userinfo: { enabled: false },
    },
    interactions: {
      async url(ctx, interaction) {
        validateAuthorizationInteraction(interaction, config.resource);
        const stateId = randomBytes(32).toString("base64url");
        const pending = state.createPending(
          stateId,
          { interactionUid: interaction.uid },
          TRANSIENT_TTL
        );
        logger.setClientName(ctx.oidc.client?.clientName);
        logger.info("oauth_interaction_started", {
          interaction_ref: logger.ref(interaction.uid),
          client_name: logger.clientName(),
          expires_at: deadline(pending, interaction),
        });
        return `/oauth/callback?begin=${stateId}`;
      },
    },
    // Every client registers the refresh_token grant, but not every client
    // asks for offline_access (ChatGPT doesn't). Without a refresh token the
    // connection would end with its one-hour access token.
    issueRefreshToken(_ctx, client) {
      return client.grantTypeAllowed("refresh_token");
    },
    jwks: { keys: [deriveSigningJwk(config.encryptionKey)] },
    rotateRefreshToken: true,
    sectorIdentifierUriValidate(client) {
      if (client.sectorIdentifierUri) {
        throw new errors.InvalidClientMetadata("sector_identifier_uri is not supported");
      }
      return false;
    },
    loadExistingGrant(ctx) {
      const grantId = ctx.oidc.result?.consent?.grantId;
      return grantId ? ctx.oidc.provider.Grant.find(grantId) : undefined;
    },
    pkce: { required: () => true },
    responseTypes: ["code"],
    routes: {
      authorization: "/authorize",
      registration: "/register",
      token: "/token",
    },
    scopes: [...ALLOWED_SCOPES],
    ttl: {
      AccessToken: ACCESS_TOKEN_TTL,
      AuthorizationCode: AUTHORIZATION_CODE_TTL,
      Grant: REFRESH_TOKEN_TTL,
      Interaction: TRANSIENT_TTL,
      RefreshToken: (_ctx, token) =>
        Math.max(
          1,
          Math.min(
            REFRESH_TOKEN_TTL,
            (token.iiat ?? config.now()) + MAX_GRANT_LIFETIME - config.now()
          )
        ),
      Session: TRANSIENT_TTL,
    },
    expiresWithSession: () => false,
    findAccount(_ctx, id) {
      return { accountId: id, claims: () => ({ sub: id }) };
    },
    renderError(ctx) {
      ctx.type = "text/plain";
      ctx.body = "OAuth request failed";
    },
  };
  const provider = new Provider(config.issuer, configuration);
  provider.proxy = true;
  provider.use(async (ctx, next) => {
    await next();
    logger.setClientName(ctx.oidc?.client?.clientName);
    const grant = ctx.oidc?.entities.Grant;
    if (
      ctx.oidc?.route === "token" &&
      ctx.oidc.params?.grant_type === "refresh_token" &&
      ctx.status === 200 &&
      grant
    ) {
      await extendGrant(grant);
    }
    if (
      ctx.oidc?.route === "token" &&
      ctx.oidc.params?.grant_type === "authorization_code" &&
      ctx.status === 200
    ) {
      const grantId = grant?.jti;
      const startedAt = grantId ? flowStarts.get(grantId) : undefined;
      if (grantId) flowStarts.delete(grantId);
      const body = ctx.body as Record<string, unknown> | undefined;
      logger.info("oauth_grant_issued", {
        grant_ref: logger.ref(grantId),
        client_name: logger.clientName(),
        refresh_token_issued: typeof body?.refresh_token === "string",
        scope: typeof body?.scope === "string" ? safeLabel(body.scope, 100) : undefined,
        flow_duration_s: startedAt === undefined ? undefined : config.now() - startedAt,
      });
    }
  });
  subscribeProviderEvents(provider, logger);
  const callback = provider.callback();

  // Each refresh moves the grant, its stored credential and the client
  // registration to REFRESH_TOKEN_TTL from now, capped at MAX_GRANT_LIFETIME
  // after sign-in.
  async function extendGrant(grant: InstanceType<Provider["Grant"]>): Promise<void> {
    const expiresAt = Math.min(config.now() + REFRESH_TOKEN_TTL, grant.iat + MAX_GRANT_LIFETIME);
    if (!grant.clientId || expiresAt <= (grant.exp ?? 0)) return;
    grant.exp = expiresAt;
    await grant.save();
    state.extendCredential(grant.jti, expiresAt);
    state.touchClient(grant.clientId, expiresAt);
  }

  async function finish(
    req: IncomingMessage,
    res: ServerResponse,
    interaction: Interaction,
    result: InteractionResults
  ): Promise<void> {
    const returnTo = await provider.interactionResult(req, res, result, {
      mergeWithLastSubmission: false,
    });
    appendResumeCookie(req, provider, interaction.uid, cookieKeys[0]);
    const resume = new URL(returnTo);
    req.url = `${resume.pathname}${resume.search}`;
    callback(req, res);
  }

  function rememberFlow(grantId: string, startedAt: number | undefined): void {
    if (startedAt === undefined) return;
    if (flowStarts.size >= MAX_TRACKED_FLOWS) {
      const oldest = flowStarts.keys().next().value;
      if (oldest !== undefined) flowStarts.delete(oldest);
    }
    flowStarts.set(grantId, startedAt);
  }

  async function loadInteraction(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<Interaction | undefined> {
    try {
      return await provider.interactionDetails(req, res);
    } catch (error) {
      if (error instanceof errors.SessionNotFound) return undefined;
      throw error;
    }
  }

  async function begin(req: IncomingMessage, res: ServerResponse, stateId: string): Promise<void> {
    const pending = state.findPending(stateId);
    if (!pending) {
      logger.info("oauth_begin", { result: "expired", reason: "pending_missing" });
      sendFlowPage(res, "expired", config.docsUrl);
      return;
    }
    const interaction = await loadInteraction(req, res);
    if (!interaction) {
      logger.info("oauth_begin", { result: "expired", reason: "interaction_missing" });
      sendFlowPage(res, "expired", config.docsUrl);
      return;
    }
    if (pending.interactionUid !== interaction.uid) throw new FlowError("binding_mismatch");
    try {
      validateAuthorizationInteraction(interaction, config.resource);
    } catch {
      throw new FlowError("invalid_request");
    }
    const clientId = stringParam(interaction, "client_id");
    const client = clientId ? await provider.Client.find(clientId) : undefined;
    if (!client?.clientName || client.clientName.length > 200) {
      throw new FlowError("client_not_found");
    }
    logger.setClientName(client.clientName);
    const expiresAt = deadline(pending, interaction);

    const connect = new URL(config.connectUrl);
    connect.searchParams.set("redirect_uri", config.callbackUrl);
    connect.searchParams.set("client_id", client.clientId);
    connect.searchParams.set("client_name", client.clientName);
    connect.searchParams.set("state", stateId);
    connect.searchParams.set("scope", stringParam(interaction, "scope")!);
    connect.searchParams.set("code_challenge", stringParam(interaction, "code_challenge")!);
    connect.searchParams.set("code_challenge_method", "S256");
    connect.searchParams.set("expires_at", String(expiresAt));
    logger.info("oauth_begin", {
      result: "ok",
      interaction_ref: logger.ref(interaction.uid),
      client_name: logger.clientName(),
      expires_at: expiresAt,
    });
    res.statusCode = 302;
    res.setHeader("Location", connect.href);
    res.end();
  }

  async function complete(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    stateId: string
  ): Promise<void> {
    const pending = state.consumePending(stateId);
    if (!pending) {
      logger.info("oauth_complete", { result: "expired", reason: "pending_missing" });
      sendFlowPage(res, "expired", config.docsUrl);
      return;
    }
    const elapsed = pending.createdAt === undefined ? undefined : config.now() - pending.createdAt;
    const interaction = await loadInteraction(req, res);
    if (!interaction) {
      logger.info("oauth_complete", {
        result: "expired",
        reason: "interaction_missing",
        duration_s: elapsed,
      });
      sendFlowPage(res, "expired", config.docsUrl);
      return;
    }
    if (pending.interactionUid !== interaction.uid) throw new FlowError("binding_mismatch");
    const interactionRef = logger.ref(interaction.uid);
    const clientId = stringParam(interaction, "client_id");
    if (url.searchParams.has("error")) {
      const denied = url.searchParams.get("error") === "access_denied";
      const client = clientId ? await provider.Client.find(clientId) : undefined;
      logger.setClientName(client?.clientName);
      logger.info("oauth_complete", {
        result: denied ? "denied" : "error",
        ...(denied ? {} : { reason: "consent_error" }),
        interaction_ref: interactionRef,
        client_name: logger.clientName(),
        duration_s: elapsed,
      });
      await finish(req, res, interaction, { error: denied ? "access_denied" : "server_error" });
      return;
    }
    const handoffCode = url.searchParams.get("code");
    if (!handoffCode || handoffCode.length > 500) throw new FlowError("handoff_code_missing");
    const client = clientId ? await provider.Client.find(clientId) : undefined;
    if (!client) throw new FlowError("client_not_found");
    logger.setClientName(client.clientName);
    const failed = (result: string, fields: Record<string, string | number | undefined> = {}) =>
      logger.warn("oauth_complete", {
        result,
        ...fields,
        interaction_ref: interactionRef,
        client_name: logger.clientName(),
        duration_s: elapsed,
      });
    let handoff: HandoffResult;
    try {
      handoff = await exchangeHandoff(handoffCode, config, logger.requestId());
    } catch (error) {
      const reason = error instanceof HandoffExchangeError ? error.reason : "unexpected";
      const status = error instanceof HandoffExchangeError ? error.status : undefined;
      failed("handoff_exchange_failed", { reason, upstream_status: status });
      await finish(req, res, interaction, { error: "server_error" });
      return;
    }
    let binding: ReturnType<typeof validateBinding>;
    try {
      binding = validateBinding(interaction, client, handoff);
    } catch {
      failed("binding_failed");
      await finish(req, res, interaction, { error: "server_error" });
      return;
    }
    let grantId: string;
    let accountId: string;
    try {
      accountId = opaqueAccountId(handoff.connection.user_id, config.encryptionKey);
      const grant = new provider.Grant({ accountId, clientId: client.clientId });
      grant.addResourceScope(
        config.resource,
        binding.scopes.filter((scope) => scope !== "offline_access").join(" ")
      );
      if (
        stringParam(interaction, "scope")?.split(" ").includes("mcp:write") &&
        !binding.scopes.includes("mcp:write")
      ) {
        grant.rejectResourceScope(config.resource, "mcp:write");
        grant.rejectOIDCScope("mcp:write");
      }
      grant.addOIDCScope(binding.scopes.join(" "));
      grantId = await grant.save();
      const grantExpiresAt = config.now() + REFRESH_TOKEN_TTL;
      state.storeCredential(grantId, binding, grantExpiresAt);
      state.touchClient(client.clientId, grantExpiresAt);
    } catch {
      failed("error", { reason: "grant_storage" });
      await finish(req, res, interaction, { error: "server_error" });
      return;
    }
    rememberFlow(grantId, pending.createdAt);
    logger.info("oauth_complete", {
      result: "ok",
      interaction_ref: interactionRef,
      grant_ref: logger.ref(grantId),
      client_name: logger.clientName(),
      access: binding.access,
      duration_s: elapsed,
    });
    try {
      await finish(req, res, interaction, {
        login: { accountId, remember: false },
        consent: { grantId },
      });
    } catch {
      failed("error", { reason: "finish_failed" });
      await finish(req, res, interaction, { error: "server_error" });
    }
  }

  return {
    provider,
    callback,
    async handleInteraction(req, res, url) {
      const beginState = url.searchParams.get("begin");
      const phase = beginState ? "oauth_begin" : "oauth_complete";
      try {
        if (beginState) {
          await begin(req, res, beginState);
          return;
        }
        const stateId = url.searchParams.get("state");
        if (!stateId) {
          logger.info("oauth_complete", { result: "expired", reason: "missing_state" });
          sendFlowPage(res, "expired", config.docsUrl);
          return;
        }
        await complete(req, res, url, stateId);
      } catch (error) {
        logger.error(phase, {
          result: "error",
          reason: error instanceof FlowError ? error.reason : "unexpected",
          client_name: logger.clientName(),
        });
        if (!res.headersSent) {
          sendFlowPage(res, "failed", config.docsUrl);
        } else if (!res.writableEnded) {
          res.end();
        }
      }
    },
  };
}
