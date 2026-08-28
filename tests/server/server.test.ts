import { mkdtempSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../../packages/server/src/config.js";
import { createWatchgooseService } from "../../packages/server/src/service.js";
import type { SqliteState } from "../../packages/server/src/database.js";
import { MAX_REFRESH_ROWS } from "../../packages/server/src/constants.js";

const ISSUER = "https://mcp.watchgoose.com";
const RESOURCE = `${ISSUER}/mcp`;
const API_KEY = `hcm_${"k".repeat(28)}`;
const UUID = "12345678-1234-5678-9234-567812345678";
const CHANNEL_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

interface RunningService {
  base: string;
  config: ServerConfig;
  state: SqliteState;
  close(): Promise<void>;
}

const running: RunningService[] = [];

function makeOriginFetch(scope: "read" | "read+write" = "read"): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/mcp/handoff/exchange/") {
      expect(url.origin).toBe("http://web:8000");
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${"w".repeat(32)}`);
      return Response.json({
        api_key: API_KEY,
        connection: {
          id: 91,
          user_id: 42,
          project_id: 73,
          client_id: "replaced-by-flow",
          client_name: "Claude Test",
          scope,
        },
      });
    }
    if (url.pathname === "/api/v3/checks/") {
      return Response.json({
        checks: [
          {
            uuid: UUID,
            name: "Nightly backup",
            status: "up",
            channels: CHANNEL_UUID,
            ping_url: "https://watchgoose.com/private-ping",
            update_url: `https://watchgoose.com/api/v3/checks/${UUID}`,
            remote_addr: "remote-secret",
            ua: "ua-secret",
            rid: "rid-secret",
            body_url: "body-secret",
          },
        ],
      });
    }
    throw new Error("unexpected test origin request");
  }) as typeof fetch;
}

async function start(fetchFn: typeof fetch = makeOriginFetch()): Promise<RunningService> {
  const directory = mkdtempSync(join(tmpdir(), "watchgoose-mcp-server-"));
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    databasePath: join(directory, "state.sqlite"),
    issuer: ISSUER,
    resource: RESOURCE,
    apiUrl: "https://watchgoose.com/api/v3",
    connectUrl: "https://watchgoose.com/mcp/connect/",
    handoffUrl: "http://web:8000/mcp/handoff/exchange/",
    callbackUrl: `${ISSUER}/oauth/callback`,
    docsUrl: "https://watchgoose.com/docs/mcp/",
    workerSecret: "w".repeat(32),
    maintenanceSecret: "m".repeat(32),
    encryptionKey: Buffer.alloc(32, 9),
    fetch: fetchFn,
    now: () => Math.floor(Date.now() / 1000),
  };
  const service = createWatchgooseService(config);
  const port = await service.start();
  const item = {
    base: `http://127.0.0.1:${port}`,
    config,
    state: service.state,
    close: () => service.close(),
  };
  running.push(item);
  return item;
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((item) => item.close()));
  vi.restoreAllMocks();
});

function cookieValues(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function mergeCookieValues(current: string, response: Response): string {
  const values = new Map<string, string>();
  for (const pair of current.split("; ").filter(Boolean)) {
    const separator = pair.indexOf("=");
    values.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0]!;
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (value) values.set(name, value);
    else values.delete(name);
  }
  return [...values].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function request(
  service: RunningService,
  path: string,
  init: RequestInit = {},
  cookies?: string
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Forwarded-Proto", "https");
  headers.set("X-Forwarded-Host", "mcp.watchgoose.com");
  if (cookies) headers.set("Cookie", cookies);
  return fetch(`${service.base}${path}`, { ...init, headers, redirect: "manual" });
}

function chunkedRequest(service: RunningService, path: string, body: string): Promise<number> {
  const base = new URL(service.base);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: base.hostname,
        port: base.port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-Host": "mcp.watchgoose.com",
          "X-Forwarded-Proto": "https",
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      }
    );
    req.once("error", reject);
    req.write(body);
    req.end();
  });
}

async function sha256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString("base64url");
}

interface OAuthResult {
  accessToken: string;
  refreshToken?: string;
  clientId: string;
  cookies: string;
  callbackState: string;
  tokenBody: Record<string, unknown>;
}

async function oauthFlow(
  service: RunningService,
  requestedScope = "mcp:read offline_access",
  effectiveScope: "read" | "read+write" = "read",
  handoffControl?: { started(): void; wait: Promise<void> }
): Promise<OAuthResult> {
  const register = await request(service, "/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude Test",
      redirect_uris: ["http://127.0.0.1:49152/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "mcp:read mcp:write offline_access",
    }),
  });
  expect(register.status, await register.clone().text()).toBe(201);
  const clientId = ((await register.json()) as { client_id: string }).client_id;
  const verifier = "v".repeat(64);
  const authorize = new URL("/authorize", service.base);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "http://127.0.0.1:49152/callback",
    scope: requestedScope,
    state: "client-state",
    code_challenge: await sha256Challenge(verifier),
    code_challenge_method: "S256",
    resource: RESOURCE,
  }).toString();
  const first = await request(service, `${authorize.pathname}${authorize.search}`);
  expect(first.status, await first.clone().text()).toBe(303);
  let cookies = cookieValues(first);
  const interactionCookies = first.headers
    .getSetCookie()
    .filter((cookie) => cookie.startsWith("__Host-wg_interaction"));
  expect(interactionCookies).toHaveLength(2);
  expect(interactionCookies.every((cookie) => cookie.includes("path=/"))).toBe(true);
  const resumeCookies = first.headers
    .getSetCookie()
    .filter((cookie) => cookie.startsWith("__Secure-wg_resume"));
  expect(resumeCookies).toHaveLength(2);
  expect(resumeCookies.every((cookie) => cookie.includes("secure"))).toBe(true);
  const location = first.headers.get("Location");
  expect(location, JSON.stringify(Object.fromEntries(first.headers))).toBeTruthy();
  const internal = new URL(location!, ISSUER);
  expect(internal.origin).toBe(ISSUER);
  expect(internal.pathname).toBe("/oauth/callback");

  const django = await request(service, `${internal.pathname}${internal.search}`, {}, cookies);
  expect(django.status).toBe(302);
  const consent = new URL(django.headers.get("Location")!);
  expect(consent.origin + consent.pathname).toBe("https://watchgoose.com/mcp/connect/");
  expect(Object.fromEntries(consent.searchParams)).toMatchObject({
    redirect_uri: `${ISSUER}/oauth/callback`,
    client_id: clientId,
    client_name: "Claude Test",
    scope: requestedScope,
    code_challenge_method: "S256",
  });
  const state = consent.searchParams.get("state")!;

  const originalFetch = service.config.fetch as ReturnType<typeof vi.fn>;
  originalFetch.mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
    handoffControl?.started();
    await handoffControl?.wait;
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${"w".repeat(32)}`);
    return Response.json({
      api_key: API_KEY,
      connection: {
        id: 91,
        user_id: 42,
        project_id: 73,
        client_id: clientId,
        client_name: "Claude Test",
        scope: effectiveScope,
      },
    });
  });
  const callback = await request(
    service,
    `/oauth/callback?state=${state}&code=single-use-handoff`,
    {},
    cookies
  );
  expect(callback.status, await callback.clone().text()).toBe(303);
  cookies = mergeCookieValues(cookies, callback);
  const callbackLocation = callback.headers.get("Location");
  expect(
    callbackLocation?.startsWith("/oauth/callback"),
    callbackLocation ?? "missing callback location"
  ).toBe(false);
  const clientRedirect = new URL(callbackLocation!);
  expect(clientRedirect.origin + clientRedirect.pathname).toBe("http://127.0.0.1:49152/callback");
  expect(clientRedirect.searchParams.get("state")).toBe("client-state");
  const authorizationCode = clientRedirect.searchParams.get("code")!;

  const wrong = await request(service, "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: authorizationCode,
      redirect_uri: "http://127.0.0.1:49152/callback",
      code_verifier: "wrong".repeat(13),
      resource: RESOURCE,
    }),
  });
  expect(wrong.status).toBe(400);
  const token = await request(service, "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: authorizationCode,
      redirect_uri: "http://127.0.0.1:49152/callback",
      code_verifier: verifier,
      resource: RESOURCE,
    }),
  });
  expect(token.status, await token.clone().text()).toBe(200);
  const tokenBody = (await token.json()) as Record<string, unknown>;
  expect(tokenBody.token_type).toBe("Bearer");
  expect(tokenBody.expires_in).toBe(3600);
  expect(JSON.stringify(tokenBody)).not.toContain("hcm_");
  return {
    accessToken: tokenBody.access_token as string,
    ...(typeof tokenBody.refresh_token === "string"
      ? { refreshToken: tokenBody.refresh_token }
      : {}),
    clientId,
    cookies,
    callbackState: state,
    tokenBody,
  };
}

function toolListBody(): string {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
}

describe("route and metadata policy", () => {
  it("serves only the exact route allowlist with no-store", async () => {
    const service = await start();
    const root = await request(service, "/");
    expect(root.status).toBe(302);
    expect(root.headers.get("Location")).toBe("https://watchgoose.com/docs/mcp/");
    expect(root.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(root.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(root.headers.get("X-Frame-Options")).toBe("DENY");
    const health = await request(service, "/healthz");
    expect(await health.json()).toEqual({ status: "ok" });
    const unauthenticatedPrune = await request(service, "/internal/prune", { method: "POST" });
    expect(unauthenticatedPrune.status).toBe(401);
    const handoffSecretPrune = await request(service, "/internal/prune", {
      method: "POST",
      headers: { Authorization: `Bearer ${"w".repeat(32)}` },
    });
    expect(handoffSecretPrune.status).toBe(401);
    const prune = await request(service, "/internal/prune", {
      method: "POST",
      headers: { Authorization: `Bearer ${"m".repeat(32)}` },
    });
    expect(prune.status).toBe(204);
    for (const path of ["/unknown", "/mcp/", "/mcp-other", "/authorize/anything"]) {
      const response = await request(service, path);
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    for (const method of ["GET", "DELETE"]) {
      const response = await request(service, "/mcp", { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
    }
    const misdirected = await fetch(`${service.base}/mcp`, { redirect: "manual" });
    expect(misdirected.status).toBe(421);
  });

  it("publishes canonical authorization and protected-resource metadata", async () => {
    const service = await start();
    const authorization = await request(service, "/.well-known/oauth-authorization-server");
    const metadata = (await authorization.json()) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      registration_endpoint: `${ISSUER}/register`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
    });
    expect(metadata.scopes_supported).toEqual(["mcp:read", "mcp:write", "offline_access"]);
    const resource = await request(service, "/.well-known/oauth-protected-resource/mcp");
    expect(await resource.json()).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      scopes_supported: ["mcp:read", "mcp:write"],
    });
  });

  it("registers hosted Claude with the advertised scopes", async () => {
    const service = await start();
    const response = await request(service, "/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "mcp:read mcp:write offline_access",
        client_name: "Claude",
        application_type: "web",
      }),
    });

    expect(response.status, await response.clone().text()).toBe(201);
    expect(await response.json()).toMatchObject({
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
      scope: "mcp:read mcp:write offline_access",
      client_name: "Claude",
      application_type: "web",
    });
  });

  it("rejects unsafe DCR metadata", async () => {
    const service = await start();
    for (const redirect of ["http://client.example/callback", "custom://callback"]) {
      const response = await request(service, "/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Unsafe",
          redirect_uris: [redirect],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code"],
          response_types: ["code"],
        }),
      });
      expect(response.status).toBe(400);
    }
    const sector = await request(service, "/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Unsafe sector fetch",
        redirect_uris: ["https://client.example/callback"],
        sector_identifier_uri: "https://attacker.example/sector.json",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      }),
    });
    expect(sector.status).toBe(400);
    expect(await chunkedRequest(service, "/register", JSON.stringify({ client_name: "x" }))).toBe(
      411
    );
  });
});

describe("OAuth and MCP integration", () => {
  it("enforces PKCE/resource binding, encrypts handoff, refreshes, and exposes three read tools", async () => {
    const service = await start();
    const flow = await oauthFlow(service, "mcp:read mcp:write offline_access", "read");
    expect(flow.tokenBody.scope).toBe("mcp:read");
    expect(flow.refreshToken).toBeTypeOf("string");
    const visibleState = JSON.stringify(
      service.state.db
        .prepare("SELECT model, payload, hex(ciphertext) AS ciphertext FROM refresh_grants")
        .all()
    );
    expect(visibleState).not.toContain(API_KEY);
    const serializedState = service.state.db.serialize().toString("latin1");
    expect(serializedState).not.toContain(flow.accessToken);
    expect(serializedState).not.toContain(flow.refreshToken!);
    const replay = await request(
      service,
      `/oauth/callback?state=${flow.callbackState}&code=single-use-handoff`,
      {},
      flow.cookies
    );
    expect(replay.status).toBe(400);

    const mcp = await request(service, "/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${flow.accessToken}`,
        "Content-Type": "application/json",
      },
      body: toolListBody(),
    });
    const body = (await mcp.json()) as { result: { tools: unknown[] } };
    expect(mcp.status).toBe(200);
    expect(body.result.tools).toHaveLength(3);

    const refreshRequest = () =>
      request(service, "/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: flow.clientId,
          refresh_token: flow.refreshToken!,
          resource: RESOURCE,
        }),
      });
    const refreshes = await Promise.all([refreshRequest(), refreshRequest()]);
    expect(refreshes.map((response) => response.status).sort()).toEqual([200, 400]);
    const successfulRefresh = refreshes.find((response) => response.status === 200)!;
    const refreshed = (await successfulRefresh.json()) as Record<string, unknown>;
    expect(refreshed).toMatchObject({ expires_in: 3600, scope: "mcp:read" });
    expect(refreshed.refresh_token).toBeTypeOf("string");
    expect(refreshed.refresh_token).not.toBe(flow.refreshToken);
  });

  it("rejects ambiguous token resource indicators", async () => {
    const service = await start();
    const flow = await oauthFlow(service);
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: flow.clientId,
      refresh_token: flow.refreshToken!,
    });
    body.append("resource", RESOURCE);
    body.append("resource", RESOURCE);
    const response = await request(service, "/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_target" });
  });

  it("exposes ten tools only for an effective write grant and never reuses transports", async () => {
    const service = await start(makeOriginFetch("read+write"));
    const flow = await oauthFlow(service, "mcp:read mcp:write", "read+write");
    const run = () =>
      request(service, "/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${flow.accessToken}`,
          "Content-Type": "application/json",
        },
        body: toolListBody(),
      });
    const concurrent = await Promise.all([run(), run(), run(), run()]);
    for (const response of concurrent) {
      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as { result: { tools: unknown[] } }).result.tools
      ).toHaveLength(10);
    }
    expect((await run()).status).toBe(200);
    expect((await run()).status).toBe(200);
  });

  it("does not consume a refresh token rejected at the concurrent capacity gate", async () => {
    const service = await start();
    const first = await oauthFlow(service);
    const second = await oauthFlow(service);
    const current = (
      service.state.db.prepare("SELECT COUNT(*) AS count FROM refresh_grants").get() as {
        count: number;
      }
    ).count;
    const fillers = MAX_REFRESH_ROWS - current - 2;
    service.state.db.exec(`
      WITH RECURSIVE rows(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM rows WHERE value < ${fillers}
      )
      INSERT INTO refresh_grants (id, model, payload, expires_at)
      SELECT printf('capacity-%06d', value), 'CapacityTest', '{}', 4102444800 FROM rows
    `);

    const refresh = (flow: OAuthResult) =>
      request(service, "/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: flow.clientId,
          refresh_token: flow.refreshToken!,
          resource: RESOURCE,
        }),
      });
    const attempts = await Promise.all([refresh(first), refresh(second)]);
    expect(attempts.map((response) => response.status).sort()).toEqual([200, 503]);
    const rejected = attempts[0]!.status === 503 ? first : second;
    service.state.db.prepare("DELETE FROM refresh_grants WHERE model='CapacityTest'").run();
    expect((await refresh(rejected)).status).toBe(200);
  });

  it("does not block token refresh behind a slow handoff exchange", async () => {
    const service = await start();
    const existing = await oauthFlow(service);
    let markStarted!: () => void;
    let releaseHandoff!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const handoffWait = new Promise<void>((resolve) => {
      releaseHandoff = resolve;
    });
    const slowFlow = oauthFlow(service, "mcp:read", "read", {
      started: markStarted,
      wait: handoffWait,
    });
    await started;

    let timeout: NodeJS.Timeout | undefined;
    try {
      const refresh = request(service, "/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: existing.clientId,
          refresh_token: existing.refreshToken!,
          resource: RESOURCE,
        }),
      });
      const response = await Promise.race([
        refresh,
        new Promise<undefined>((resolve) => {
          timeout = setTimeout(() => resolve(undefined), 2_000);
        }),
      ]);
      expect(response, "refresh was blocked by the handoff exchange").toBeDefined();
      expect(response!.status).toBe(200);
    } finally {
      if (timeout) clearTimeout(timeout);
      releaseHandoff();
      await slowFlow;
    }
  });

  it("forces consent for a returning provider session", async () => {
    const service = await start();
    const flow = await oauthFlow(service, "mcp:read", "read");
    expect(flow.cookies).toContain("__Host-wg_session=");
    const verifier = "r".repeat(64);
    const authorize = new URL("/authorize", service.base);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: flow.clientId,
      redirect_uri: "http://127.0.0.1:49152/callback",
      scope: "mcp:read",
      state: "returning-client-state",
      code_challenge: await sha256Challenge(verifier),
      code_challenge_method: "S256",
      resource: RESOURCE,
    }).toString();
    const withoutResource = new URL(authorize);
    withoutResource.searchParams.delete("resource");
    const rejected = await request(
      service,
      `${withoutResource.pathname}${withoutResource.search}`,
      {},
      flow.cookies
    );
    expect(rejected.status).toBe(303);
    const rejectedLocation = new URL(rejected.headers.get("Location")!);
    expect(rejectedLocation.origin + rejectedLocation.pathname).toBe(
      "http://127.0.0.1:49152/callback"
    );
    expect(rejectedLocation.searchParams.get("error")).toBe("invalid_target");
    expect(rejectedLocation.searchParams.get("state")).toBe("returning-client-state");

    const duplicateResource = new URL(authorize);
    duplicateResource.searchParams.append("resource", RESOURCE);
    const duplicate = await request(
      service,
      `${duplicateResource.pathname}${duplicateResource.search}`,
      {},
      flow.cookies
    );
    expect(duplicate.status).toBe(303);
    expect(new URL(duplicate.headers.get("Location")!).searchParams.get("error")).toBe(
      "invalid_target"
    );

    const response = await request(
      service,
      `${authorize.pathname}${authorize.search}`,
      {},
      flow.cookies
    );
    expect(response.status).toBe(303);
    const interaction = new URL(response.headers.get("Location")!, ISSUER);
    expect(interaction.pathname).toBe("/oauth/callback");
    expect(interaction.searchParams.has("begin")).toBe(true);
  });

  it("negotiates the modern protocol with a fresh JSON-only exchange", async () => {
    const service = await start();
    const flow = await oauthFlow(service, "mcp:read", "read");
    const response = await request(service, "/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${flow.accessToken}`,
        "Content-Type": "application/json",
        "MCP-Method": "tools/list",
        "MCP-Protocol-Version": "2026-07-28",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          },
        },
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.text()).not.toContain("text/event-stream");
  });

  it("negotiates server/discover with the pinned v2 HTTP client", async () => {
    const service = await start();
    const flow = await oauthFlow(service, "mcp:read", "read");
    const client = new Client(
      { name: "watchgoose-server-test", version: "0.1.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    const transport = new StreamableHTTPClientTransport(new URL(`${service.base}/mcp`), {
      authProvider: { token: async () => flow.accessToken },
      requestInit: {
        headers: {
          "X-Forwarded-Host": "mcp.watchgoose.com",
          "X-Forwarded-Proto": "https",
        },
      },
    });
    try {
      await client.connect(transport);
      expect(client.getDiscoverResult()).toBeDefined();
      expect((await client.listTools()).tools).toHaveLength(3);
      const result = await client.callTool({ name: "list_checks", arguments: { limit: 1 } });
      expect(result.isError).not.toBe(true);
    } finally {
      await client.close();
    }
  });

  it("does not disclose request, credential, or origin sentinels", async () => {
    const service = await start();
    const spies = ["log", "info", "warn", "error"].map((method) =>
      vi.spyOn(console, method as "log").mockImplementation(() => undefined)
    );
    const flow = await oauthFlow(service);
    const response = await request(service, "/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${flow.accessToken}`,
        Cookie: "session=cookie-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_checks", arguments: { slug: "payload-secret" } },
      }),
    });
    const text = await response.text();
    const errorResponse = await request(service, "/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${"bearer-error-sentinel".padEnd(40, "x")}`,
        Cookie: "session=error-cookie-sentinel",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tool_payload: "error-payload-sentinel" }),
    });
    const errorText = await errorResponse.text();
    const logs = spies
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .join(" ");
    expect(logs).toBe("");
    for (const sentinel of [
      API_KEY,
      flow.accessToken,
      flow.refreshToken!,
      UUID,
      CHANNEL_UUID,
      "cookie-secret",
      "payload-secret",
      "remote-secret",
      "ua-secret",
      "rid-secret",
      "body-secret",
      "single-use-handoff",
      "bearer-error-sentinel",
      "error-cookie-sentinel",
      "error-payload-sentinel",
    ]) {
      expect(text).not.toContain(sentinel);
      expect(errorText).not.toContain(sentinel);
      expect(logs).not.toContain(sentinel);
    }
  });

  it("turns the same origin 401 into OAuth 401 and invalidates the local grant", async () => {
    const fetchFn = makeOriginFetch();
    const service = await start(fetchFn);
    const flow = await oauthFlow(service);
    (fetchFn as ReturnType<typeof vi.fn>).mockImplementationOnce(async () =>
      Response.json({ error: API_KEY }, { status: 401 })
    );
    const call = () =>
      request(service, "/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${flow.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "list_checks", arguments: {} },
        }),
      });
    const first = await call();
    expect(first.status).toBe(401);
    expect(first.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
    expect(await first.text()).not.toContain(API_KEY);
    expect((await call()).status).toBe(401);
  });

  it("rejects missing PKCE, wrong audience, callback replay, and unsupported MCP modes", async () => {
    const service = await start();
    const register = await request(service, "/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude Test",
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      }),
    });
    const clientId = ((await register.json()) as { client_id: string }).client_id;
    for (const query of [
      new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "https://client.example/callback",
        scope: "mcp:read",
        resource: RESOURCE,
      }),
      new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "https://client.example/callback",
        scope: "mcp:read",
        resource: `${ISSUER}/other`,
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
      }),
    ]) {
      const response = await request(service, `/authorize?${query}`);
      expect([302, 303, 400]).toContain(response.status);
      expect(response.headers.get("Location") ?? "").not.toContain("watchgoose.com/mcp/connect");
    }
    const unauthorized = await request(service, "/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: toolListBody(),
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("WWW-Authenticate")).toContain(
      `${ISSUER}/.well-known/oauth-protected-resource/mcp`
    );
  });
});
