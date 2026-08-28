import { randomBytes } from "node:crypto";
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
  MAX_HANDOFF_RESPONSE_BYTES,
  MCP_SCOPES,
  REFRESH_TOKEN_TTL,
  TRANSIENT_TTL,
} from "./constants.js";
import { deriveCookieKeys, deriveSigningJwk, opaqueAccountId, signCookie } from "./crypto.js";
import type { SqliteState, StoredCredential } from "./database.js";
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
    clientState.length > 500 ||
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
    throw new Error("handoff response is too large");
  }
  if (!response.body) throw new Error("invalid handoff response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_HANDOFF_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("handoff response is too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function exchangeHandoff(code: string, config: ServerConfig): Promise<HandoffResult> {
  const response = await config.fetch(config.handoffUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.workerSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("handoff exchange failed");
  }
  return parseHandoff(await readBoundedJson(response));
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

export function createOAuthService(config: ServerConfig, state: SqliteState): OAuthService {
  const cookieKeys = deriveCookieKeys(config.encryptionKey);
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
      async url(_ctx, interaction) {
        validateAuthorizationInteraction(interaction, config.resource);
        const stateId = randomBytes(32).toString("base64url");
        state.createPending(stateId, { interactionUid: interaction.uid }, TRANSIENT_TTL);
        return `/oauth/callback?begin=${stateId}`;
      },
    },
    issueRefreshToken(_ctx, client, code) {
      return client.grantTypeAllowed("refresh_token") && code.scopes.has("offline_access");
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
      RefreshToken: REFRESH_TOKEN_TTL,
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
  const callback = provider.callback();

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

  async function begin(req: IncomingMessage, res: ServerResponse, stateId: string): Promise<void> {
    const pending = state.findPending(stateId);
    if (!pending) {
      res.statusCode = 400;
      res.end("Authorization request expired");
      return;
    }
    const interaction = await provider.interactionDetails(req, res);
    if (pending.interactionUid !== interaction.uid) throw new Error("interaction binding mismatch");
    validateAuthorizationInteraction(interaction, config.resource);
    const clientId = stringParam(interaction, "client_id");
    const client = clientId ? await provider.Client.find(clientId) : undefined;
    if (!client?.clientName || client.clientName.length > 200) throw new Error("client not found");

    const connect = new URL(config.connectUrl);
    connect.searchParams.set("redirect_uri", config.callbackUrl);
    connect.searchParams.set("client_id", client.clientId);
    connect.searchParams.set("client_name", client.clientName);
    connect.searchParams.set("state", stateId);
    connect.searchParams.set("scope", stringParam(interaction, "scope")!);
    connect.searchParams.set("code_challenge", stringParam(interaction, "code_challenge")!);
    connect.searchParams.set("code_challenge_method", "S256");
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
      res.statusCode = 400;
      res.end("Authorization request expired");
      return;
    }
    const interaction = await provider.interactionDetails(req, res);
    if (pending.interactionUid !== interaction.uid) throw new Error("interaction binding mismatch");
    if (url.searchParams.has("error")) {
      await finish(req, res, interaction, {
        error: url.searchParams.get("error") === "access_denied" ? "access_denied" : "server_error",
      });
      return;
    }
    const handoffCode = url.searchParams.get("code");
    if (!handoffCode || handoffCode.length > 500) throw new Error("handoff code missing");
    const clientId = stringParam(interaction, "client_id");
    const client = clientId ? await provider.Client.find(clientId) : undefined;
    if (!client) throw new Error("client not found");
    try {
      const handoff = await exchangeHandoff(handoffCode, config);
      const binding = validateBinding(interaction, client, handoff);
      const accountId = opaqueAccountId(handoff.connection.user_id, config.encryptionKey);
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
      const grantId = await grant.save();
      const grantExpiresAt = config.now() + REFRESH_TOKEN_TTL;
      state.storeCredential(grantId, binding, grantExpiresAt);
      state.touchClient(client.clientId, grantExpiresAt);
      await finish(req, res, interaction, {
        login: { accountId, remember: false },
        consent: { grantId },
      });
    } catch {
      await finish(req, res, interaction, { error: "server_error" });
    }
  }

  return {
    provider,
    callback,
    async handleInteraction(req, res, url) {
      try {
        const beginState = url.searchParams.get("begin");
        if (beginState) {
          await begin(req, res, beginState);
          return;
        }
        const stateId = url.searchParams.get("state");
        if (!stateId) {
          res.statusCode = 400;
          res.end("Authorization request expired");
          return;
        }
        await complete(req, res, url, stateId);
      } catch {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Authorization failed");
        } else if (!res.writableEnded) {
          res.end();
        }
      }
    },
  };
}
