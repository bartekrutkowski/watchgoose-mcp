import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { deriveKey } from "./crypto.js";

// Structured JSON lines on stdout, one object per line. Callers pass only
// fixed event names and short, non-secret fields; never tokens, codes, state
// ids, secrets, headers, cookies, emails, IP addresses, query strings or
// bodies.

export type LogLevel = "info" | "warn" | "error";
export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;
export type LogSink = (line: string) => void;

export type RouteCategory =
  | "mcp"
  | "oauth_authorize"
  | "oauth_token"
  | "oauth_register"
  | "oauth_discovery"
  | "oauth_callback"
  | "health"
  | "other";

interface RequestContext {
  requestId?: string;
  clientName?: string;
}

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;
const USER_AGENT_TOKEN = /^[A-Za-z0-9._/+-]+/;
const EMAIL_LIKE = /[^\s@]*@[^\s@]*/g;
const IPV4_LIKE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export function parseRequestId(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && REQUEST_ID.test(value) ? value : undefined;
}

// A short, single-line label for a value that came from a client (registered
// client_name, error description). Email and IPv4 address lookalikes are
// dropped.
export function safeLabel(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(CONTROL, " ")
    .replace(EMAIL_LIKE, "[redacted]")
    .replace(IPV4_LIKE, "[redacted]")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

export function clientFamily(userAgent: string | string[] | undefined): string {
  if (typeof userAgent !== "string") return "unknown";
  const match = USER_AGENT_TOKEN.exec(userAgent.trim());
  return (match && safeLabel(match[0], 40)) || "unknown";
}

export function routeCategory(pathname: string): RouteCategory {
  switch (pathname) {
    case "/mcp":
      return "mcp";
    case "/authorize":
      return "oauth_authorize";
    case "/token":
      return "oauth_token";
    case "/register":
      return "oauth_register";
    case "/oauth/callback":
      return "oauth_callback";
    case "/.well-known/oauth-authorization-server":
    case "/.well-known/oauth-protected-resource/mcp":
      return "oauth_discovery";
    case "/healthz":
      return "health";
    default:
      return "other";
  }
}

export class Logger {
  private readonly context = new AsyncLocalStorage<RequestContext>();
  private readonly correlationKey: Buffer | undefined;

  constructor(
    private readonly sink: LogSink = (line) => void process.stdout.write(`${line}\n`),
    encryptionKey?: Buffer
  ) {
    this.correlationKey = encryptionKey ? deriveKey(encryptionKey, "log-correlation") : undefined;
  }

  // Runs one HTTP request with its request id available to every log line
  // written while handling it, including oidc-provider event handlers.
  runRequest<T>(req: IncomingMessage, fn: () => T): T {
    const requestId = parseRequestId(req.headers["x-request-id"]);
    return this.context.run(requestId ? { requestId } : {}, fn);
  }

  // Remembers the registered client name for the current request so later
  // lines (http_request) can name the client.
  setClientName(name: unknown): void {
    const store = this.context.getStore();
    const label = safeLabel(name, 60);
    if (store && label) store.clientName = label;
  }

  clientName(): string | undefined {
    return this.context.getStore()?.clientName;
  }

  // The current request id, sent to the Watchgoose app as X-Correlation-ID
  // so its log lines can be matched with ours.
  requestId(): string | undefined {
    return this.context.getStore()?.requestId;
  }

  // First 12 hex characters of an HMAC of an internal identifier (grant id or
  // interaction uid). It links lines of one flow without revealing the id.
  ref(value: string | undefined): string | undefined {
    if (!value || !this.correlationKey) return undefined;
    return createHmac("sha256", this.correlationKey).update(value).digest("hex").slice(0, 12);
  }

  info(event: string, fields?: LogFields): void {
    this.write("info", event, fields);
  }

  warn(event: string, fields?: LogFields): void {
    this.write("warn", event, fields);
  }

  error(event: string, fields?: LogFields): void {
    this.write("error", event, fields);
  }

  write(level: LogLevel, event: string, fields: LogFields = {}): void {
    try {
      const line: Record<string, LogValue> = { ts: new Date().toISOString(), level, event };
      const requestId = this.context.getStore()?.requestId;
      if (requestId) line.request_id = requestId;
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && !(key in line)) line[key] = value;
      }
      this.sink(JSON.stringify(line));
    } catch {
      // Logging never breaks a request.
    }
  }
}
