import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import {
  API_URL,
  CALLBACK_URL,
  CONNECT_URL,
  DOCS_URL,
  HANDOFF_URL,
  ISSUER,
  RESOURCE,
} from "./constants.js";

export interface ServerConfig {
  host: string;
  port: number;
  databasePath: string;
  issuer: string;
  resource: string;
  apiUrl: string;
  connectUrl: string;
  handoffUrl: string;
  callbackUrl: string;
  docsUrl: string;
  workerSecret: string;
  maintenanceSecret: string;
  encryptionKey: Buffer;
  fetch: typeof globalThis.fetch;
  now: () => number;
  onListen?: ((server: Server) => void) | undefined;
}

function readSecret(path: string | undefined, variable: string): Buffer {
  if (!path) throw new Error(`${variable} is required`);
  return readFileSync(path);
}

export function parseEncryptionKey(value: Buffer | string): Buffer {
  const encoded = Buffer.isBuffer(value) ? value.toString("ascii").trim() : value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(encoded)) return Buffer.from(encoded, "hex");

  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error("MCP_STATE_ENCRYPTION_KEY_FILE must contain 32 bytes as hex or base64");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("MCP_STATE_ENCRYPTION_KEY_FILE must contain 32 bytes as hex or base64");
  }
  return key;
}

function parsePort(value: string | undefined): number {
  const port = value === undefined ? 8080 : Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("MCP_PORT must be an integer from 1 to 65535");
  }
  return port;
}

export function loadProductionConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const workerSecret = readSecret(env.MCP_WORKER_SECRET_FILE, "MCP_WORKER_SECRET_FILE")
    .toString("utf8")
    .trim();
  if (workerSecret.length < 32 || workerSecret.length > 4096) {
    throw new Error("MCP_WORKER_SECRET_FILE contains an invalid secret");
  }
  const maintenanceSecret = readSecret(
    env.MCP_MAINTENANCE_SECRET_FILE,
    "MCP_MAINTENANCE_SECRET_FILE"
  )
    .toString("utf8")
    .trim();
  if (maintenanceSecret.length < 32 || maintenanceSecret.length > 4096) {
    throw new Error("MCP_MAINTENANCE_SECRET_FILE contains an invalid secret");
  }
  const encryptionKey = parseEncryptionKey(
    readSecret(env.MCP_STATE_ENCRYPTION_KEY_FILE, "MCP_STATE_ENCRYPTION_KEY_FILE")
  );

  const config: ServerConfig = {
    host: env.MCP_HOST ?? "0.0.0.0",
    port: parsePort(env.MCP_PORT),
    databasePath: env.MCP_STATE_DATABASE ?? "/data/oauth.sqlite",
    issuer: ISSUER,
    resource: RESOURCE,
    apiUrl: API_URL,
    connectUrl: CONNECT_URL,
    handoffUrl: HANDOFF_URL,
    callbackUrl: CALLBACK_URL,
    docsUrl: DOCS_URL,
    workerSecret,
    maintenanceSecret,
    encryptionKey,
    fetch: globalThis.fetch,
    now: () => Math.floor(Date.now() / 1000),
  };
  validateCanonicalConfig(config);
  return config;
}

export function validateCanonicalConfig(config: ServerConfig): void {
  const expected = {
    issuer: ISSUER,
    resource: RESOURCE,
    apiUrl: API_URL,
    connectUrl: CONNECT_URL,
    handoffUrl: HANDOFF_URL,
    callbackUrl: CALLBACK_URL,
    docsUrl: DOCS_URL,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (config[key as keyof typeof expected] !== value) {
      throw new Error(`production ${key} must use the canonical URL`);
    }
  }
  if (config.encryptionKey.length !== 32) throw new Error("encryption key must be 32 bytes");
}
