/** Shared user-facing release version for every Watchgoose MCP distribution. */
export const WATCHGOOSE_RELEASE_VERSION = "1.1.0";

export const DEFAULT_API_URL = "https://watchgoose.com/api/v3";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_RESPONSE_BYTES = 1_048_576;
export const MAX_SERIALIZED_OUTPUT_CHARS = 24_000;

export const RESULT_CAPS = {
  checks: 100,
  pings: 100,
  flips: 200,
  channels: 100,
} as const;

export type AccessLevel = "read-only" | "read-write";
