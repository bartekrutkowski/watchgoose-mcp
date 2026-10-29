import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WATCHGOOSE_RELEASE_VERSION } from "@watchgoose/mcp-core";
import type { ServerConfig } from "./config.js";
import {
  ACCESS_TOKEN_TTL,
  ALLOWED_SCOPES,
  AUTHORIZATION_CODE_TTL,
  MAX_DCR_BYTES,
  MAX_GRANT_LIFETIME,
  MCP_SCOPES,
  REFRESH_TOKEN_TTL,
  TRANSIENT_TTL,
} from "./constants.js";
import { SqliteState } from "./database.js";
import { clientFamily, Logger, routeCategory } from "./logger.js";
import { handleMcp } from "./mcp.js";
import { createOAuthService } from "./oauth.js";

const METHOD_POLICY: Readonly<Record<string, readonly string[]>> = {
  "/": ["GET"],
  "/healthz": ["GET"],
  "/internal/prune": ["POST"],
  "/mcp": ["POST"],
  "/authorize": ["GET"],
  "/token": ["POST"],
  "/register": ["POST"],
  "/oauth/callback": ["GET"],
  "/.well-known/oauth-authorization-server": ["GET"],
  "/.well-known/oauth-protected-resource/mcp": ["GET"],
  "/.well-known/openai-apps-challenge": ["GET", "HEAD"],
};

function sendWebResponse(res: ServerResponse, response: Response): void {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.setHeader("Cache-Control", "no-store");
  void response
    .arrayBuffer()
    .then((body) => res.end(Buffer.from(body)))
    .catch(() => res.end());
}

function fixedResponse(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
}

function hasBearerSecret(req: IncomingMessage, secret: string): boolean {
  const provided = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function hostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "invalid";
  }
}

export interface WatchgooseService {
  state: SqliteState;
  logger: Logger;
  start(): Promise<number>;
  close(): Promise<void>;
}

export function createWatchgooseService(config: ServerConfig): WatchgooseService {
  const logger = new Logger(config.log, config.encryptionKey);
  const state = new SqliteState(config.databasePath, config.encryptionKey, config.now);
  const oauth = createOAuthService(config, state, logger);
  let listening = false;
  let reservedRefreshRows = 0;

  const server = createServer((req, res) => {
    logger.runRequest(req, () => {
      trackRequest(req, res);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      void route(req, res).catch(() => {
        logger.error("request_failed");
        if (!res.headersSent) fixedResponse(res, 500, "Internal server error");
        else if (!res.writableEnded) res.end();
      });
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  // One http_request line per request, written when the response finishes
  // or the connection closes first. The route category comes from the
  // original path, before any internal rewrite.
  function trackRequest(req: IncomingMessage, res: ServerResponse): void {
    const started = process.hrtime.bigint();
    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", config.issuer).pathname;
    } catch {
      // Unparseable targets are categorized as other.
    }
    const route = routeCategory(pathname);
    const method = /^[A-Z]{1,10}$/.test(req.method ?? "") ? req.method : "other";
    const family = clientFamily(req.headers["user-agent"]);
    let logged = false;
    const done = () => {
      if (logged) return;
      logged = true;
      res.removeListener("finish", done);
      res.removeListener("close", done);
      logger.info("http_request", {
        method,
        route,
        status: res.statusCode,
        duration_ms: Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10,
        client_family: family,
        client_name: logger.clientName(),
        ...(res.writableFinished ? {} : { aborted: true }),
      });
    };
    res.once("finish", done);
    res.once("close", done);
  }

  function reserveRefreshRows(rows: number): (() => void) | undefined {
    if (!state.hasRefreshCapacity(rows + reservedRefreshRows)) return undefined;
    reservedRefreshRows += rows;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      reservedRefreshRows -= rows;
    };
  }

  function runProvider(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = () => {
        res.removeListener("finish", done);
        res.removeListener("close", done);
        resolve();
      };
      res.once("finish", done);
      res.once("close", done);
      try {
        oauth.callback(req, res);
      } catch (error) {
        res.removeListener("finish", done);
        res.removeListener("close", done);
        reject(error);
      }
    });
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", config.issuer);
    if (url.pathname !== "/healthz" && url.pathname !== "/internal/prune") {
      const expectedHost = new URL(config.issuer).host;
      if (
        req.headers["x-forwarded-proto"] !== "https" ||
        req.headers["x-forwarded-host"] !== expectedHost
      ) {
        fixedResponse(res, 421, "Misdirected Request");
        return;
      }
    }
    const methods = METHOD_POLICY[url.pathname];
    if (!methods) {
      fixedResponse(res, 404, "Not found");
      return;
    }
    if (!methods.includes(req.method ?? "")) {
      res.setHeader("Allow", methods.join(", "));
      fixedResponse(res, 405, "Method not allowed");
      return;
    }
    if (url.pathname === "/") {
      res.statusCode = 302;
      res.setHeader("Location", config.docsUrl);
      res.end();
      return;
    }
    if (url.pathname === "/healthz") {
      if (!listening || !state.isHealthy()) {
        fixedResponse(res, 503, "unhealthy");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (url.pathname === "/internal/prune") {
      if (!hasBearerSecret(req, config.maintenanceSecret)) {
        fixedResponse(res, 401, "Unauthorized");
        return;
      }
      state.prune(10_000);
      res.statusCode = 204;
      res.end();
      return;
    }
    if (url.pathname === "/.well-known/openai-apps-challenge") {
      if (config.openAiAppsChallengeToken === undefined) {
        fixedResponse(res, 404, "Not found");
        return;
      }
      fixedResponse(res, 200, req.method === "HEAD" ? "" : config.openAiAppsChallengeToken);
      return;
    }
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          resource: config.resource,
          authorization_servers: [config.issuer],
          scopes_supported: MCP_SCOPES,
          bearer_methods_supported: ["header"],
          resource_name: "Watchgoose MCP",
        })
      );
      return;
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          issuer: config.issuer,
          authorization_endpoint: `${config.issuer}/authorize`,
          token_endpoint: `${config.issuer}/token`,
          registration_endpoint: `${config.issuer}/register`,
          response_types_supported: ["code"],
          response_modes_supported: ["query"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          scopes_supported: ALLOWED_SCOPES,
          code_challenge_methods_supported: ["S256"],
          authorization_response_iss_parameter_supported: true,
        })
      );
      return;
    }
    if (url.pathname === "/oauth/callback") {
      const completesAuthorization = url.searchParams.has("state");
      const release = completesAuthorization ? reserveRefreshRows(4) : () => undefined;
      if (!release) {
        fixedResponse(res, 503, "Temporarily unavailable");
        return;
      }
      try {
        await oauth.handleInteraction(req, res, url);
      } finally {
        release();
      }
      return;
    }
    if (url.pathname === "/mcp") {
      sendWebResponse(res, await handleMcp(req, oauth.provider, state, config, logger));
      return;
    }
    if (url.pathname === "/register") {
      const header = req.headers["content-length"];
      if (header === undefined) {
        fixedResponse(res, 411, "Content-Length required");
        return;
      }
      if (!/^\d+$/.test(header)) {
        fixedResponse(res, 400, "Invalid Content-Length");
        return;
      }
      const length = Number(header);
      if (!Number.isSafeInteger(length) || length > MAX_DCR_BYTES) {
        fixedResponse(res, 413, "Client metadata too large");
        return;
      }
    }
    if (url.pathname === "/authorize") {
      const prompts = new Set(url.searchParams.get("prompt")?.split(" ").filter(Boolean));
      prompts.add("consent");
      url.searchParams.set("prompt", [...prompts].join(" "));
      req.url = `${url.pathname}${url.search}`;
    }
    if (url.pathname === "/token") {
      const release = reserveRefreshRows(2);
      if (!release) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "temporarily_unavailable" }));
        return;
      }
      try {
        await runProvider(req, res);
      } finally {
        release();
      }
      return;
    }
    oauth.callback(req, res);
  }

  return {
    state,
    logger,
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.removeListener("error", reject);
          listening = true;
          logger.info("server_started", {
            version: WATCHGOOSE_RELEASE_VERSION,
            transient_ttl_s: TRANSIENT_TTL,
            authorization_code_ttl_s: AUTHORIZATION_CODE_TTL,
            access_token_ttl_s: ACCESS_TOKEN_TTL,
            refresh_token_ttl_s: REFRESH_TOKEN_TTL,
            max_grant_lifetime_s: MAX_GRANT_LIFETIME,
            issuer_host: hostOf(config.issuer),
            callback_host: hostOf(config.callbackUrl),
            connect_host: hostOf(config.connectUrl),
            handoff_host: hostOf(config.handoffUrl),
            api_host: hostOf(config.apiUrl),
          });
          config.onListen?.(server);
          resolve((server.address() as AddressInfo).port);
        });
      });
    },
    close() {
      listening = false;
      return new Promise((resolve, reject) => {
        server.close((error) => {
          state.close();
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
