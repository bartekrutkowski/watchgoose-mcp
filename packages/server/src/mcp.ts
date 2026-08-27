import type { IncomingMessage } from "node:http";
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
  createMcpHandler,
  isLegacyRequest,
} from "@modelcontextprotocol/server";
import { registerWatchgooseTools } from "@watchgoose/mcp-core";
import type Provider from "oidc-provider";
import type { ServerConfig } from "./config.js";
import { MAX_MCP_REQUEST_BYTES } from "./constants.js";
import type { SqliteState, StoredCredential } from "./database.js";
import { isAllowedOrigin } from "./security.js";

const REJECTED_METHODS = new Set([
  "resources/subscribe",
  "resources/unsubscribe",
  "subscriptions/listen",
]);
const JSON_MODE_WARNING =
  "responseMode: 'json' drops mid-call notifications. subscriptions/listen streams are always served over SSE regardless; other notifications emitted before a result are dropped.";

function jsonError(status: number, code: number, message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status, headers: { "Content-Type": "application/json" } }
  );
}

export function bearerError(
  config: ServerConfig,
  status: 401 | 403,
  error: "invalid_token" | "insufficient_scope"
): Response {
  const scope = error === "insufficient_scope" ? ', scope="mcp:read"' : "";
  return new Response(null, {
    status,
    headers: {
      "WWW-Authenticate": `Bearer error="${error}", resource_metadata="${config.issuer}/.well-known/oauth-protected-resource/mcp"${scope}`,
    },
  });
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_MCP_REQUEST_BYTES) return undefined;
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    length += buffer.length;
    if (length > MAX_MCP_REQUEST_BYTES) return undefined;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function isJsonContentType(value: string | undefined): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function acceptsJson(value: string | undefined): boolean {
  if (value === undefined) return true;
  return value
    .split(",")
    .map((part) => part.split(";", 1)[0]!.trim().toLowerCase())
    .some((part) => part === "*/*" || part === "application/json");
}

function requestMethods(body: unknown): string[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages.flatMap((message) => {
    if (typeof message !== "object" || message === null) return [];
    const method = (message as { method?: unknown }).method;
    return typeof method === "string" ? [method] : [];
  });
}

function createWebRequest(req: IncomingMessage, config: ServerConfig, body: Buffer): Request {
  const headers = new Headers();
  for (const name of ["accept", "content-type", "mcp-method", "mcp-protocol-version"]) {
    const value = req.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  return new Request(config.resource, {
    method: "POST",
    headers,
    body: new Uint8Array(body),
  });
}

function createMcpServer(
  credential: StoredCredential,
  config: ServerConfig,
  originFetch: typeof globalThis.fetch,
  scopes: Set<string>
): McpServer {
  const server = new McpServer(
    { name: "watchgoose-mcp", version: "0.1.0" },
    { capabilities: { tools: { listChanged: false } } }
  );
  const canWrite = scopes.has("mcp:write") && credential.access === "read-write";
  registerWatchgooseTools(server, {
    apiKey: credential.apiKey,
    apiUrl: config.apiUrl,
    access: canWrite ? "read-write" : "read-only",
    enableWrites: canWrite,
    fetch: originFetch,
  });
  return server;
}

async function serveLegacy(
  request: Request,
  body: unknown,
  createServer: () => McpServer
): Promise<Response> {
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    keepAliveMs: 0,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request, { parsedBody: body });
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

async function serveModern(
  request: Request,
  body: unknown,
  createServer: () => McpServer
): Promise<Response> {
  const originalWarn = console.warn;
  console.warn = (message?: unknown, ...args: unknown[]) => {
    if (message !== JSON_MODE_WARNING) originalWarn(message, ...args);
  };
  let handler: ReturnType<typeof createMcpHandler>;
  try {
    // The SDK emits this fixed warning on every JSON-mode construction.
    handler = createMcpHandler(createServer, {
      legacy: "reject",
      responseMode: "json",
      keepAliveMs: 0,
    });
  } finally {
    console.warn = originalWarn;
  }
  try {
    const response = await handler.fetch(request, { parsedBody: body });
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      await response.body?.cancel();
      return jsonError(406, -32601, "Streaming is not supported");
    }
    return response;
  } finally {
    await handler.close();
  }
}

async function authenticate(
  req: IncomingMessage,
  provider: Provider,
  state: SqliteState,
  config: ServerConfig
): Promise<{ credential: StoredCredential; scopes: Set<string>; grantId: string } | Response> {
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/i.exec(req.headers.authorization ?? "");
  if (!match) return bearerError(config, 401, "invalid_token");
  const token = await provider.AccessToken.find(match[1]!);
  if (
    !token ||
    token.isExpired ||
    !token.clientId ||
    !token.grantId ||
    (token.aud !== config.resource &&
      !(Array.isArray(token.aud) && token.aud.length === 1 && token.aud[0] === config.resource))
  ) {
    return bearerError(config, 401, "invalid_token");
  }
  const scopes = new Set(token.scope?.split(" ").filter(Boolean));
  if (
    !scopes.has("mcp:read") ||
    [...scopes].some((scope) => !["mcp:read", "mcp:write", "offline_access"].includes(scope))
  ) {
    return bearerError(config, 403, "insufficient_scope");
  }
  const [client, grant] = await Promise.all([
    provider.Client.find(token.clientId),
    provider.Grant.find(token.grantId),
  ]);
  const granted = new Set(grant?.getResourceScope(config.resource).split(" ").filter(Boolean));
  if (
    !client ||
    !grant ||
    grant.clientId !== token.clientId ||
    grant.accountId !== token.accountId ||
    [...scopes].some((scope) => scope !== "offline_access" && !granted.has(scope))
  ) {
    return bearerError(config, 401, "invalid_token");
  }
  const credential = state.loadCredential(token.grantId);
  if (!credential) return bearerError(config, 401, "invalid_token");
  return { credential, scopes, grantId: token.grantId };
}

export async function handleMcp(
  req: IncomingMessage,
  provider: Provider,
  state: SqliteState,
  config: ServerConfig
): Promise<Response> {
  if (!isAllowedOrigin(req.headers.origin)) {
    return jsonError(403, -32600, "Invalid Origin");
  }
  if (!isJsonContentType(req.headers["content-type"])) {
    return jsonError(415, -32600, "Content-Type must be application/json");
  }
  if (!acceptsJson(req.headers.accept)) {
    return jsonError(406, -32600, "Only JSON responses are supported");
  }
  const authentication = await authenticate(req, provider, state, config);
  if (authentication instanceof Response) return authentication;
  const rawBody = await readBody(req);
  if (!rawBody) return jsonError(413, -32600, "Request too large");
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    return jsonError(400, -32700, "Parse error");
  }
  if (requestMethods(body).some((method) => REJECTED_METHODS.has(method))) {
    return jsonError(405, -32601, "Subscriptions are not supported");
  }

  let originUnauthorized = false;
  const originFetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const expected = new URL(config.apiUrl);
    if (
      url.origin !== expected.origin ||
      !url.pathname.startsWith(`${expected.pathname.replace(/\/$/, "")}/`)
    ) {
      throw new Error("unexpected origin request");
    }
    const headers = new Headers(init?.headers);
    if (
      headers.has("authorization") ||
      headers.has("cookie") ||
      headers.get("x-api-key") !== authentication.credential.apiKey ||
      [...headers.keys()].some(
        (name) => !["accept", "content-type", "x-api-key"].includes(name.toLowerCase())
      )
    ) {
      throw new Error("unexpected origin headers");
    }
    const response = await config.fetch(input, init);
    if (response.status === 401) originUnauthorized = true;
    return response;
  };
  const request = createWebRequest(req, config, rawBody);
  const createServer = () =>
    createMcpServer(authentication.credential, config, originFetch, authentication.scopes);
  const response = (await isLegacyRequest(request.clone(), body))
    ? await serveLegacy(request, body, createServer)
    : await serveModern(request, body, createServer);
  if (originUnauthorized) {
    state.invalidateGrant(authentication.grantId);
    await response.body?.cancel();
    return bearerError(config, 401, "invalid_token");
  }
  return response;
}
