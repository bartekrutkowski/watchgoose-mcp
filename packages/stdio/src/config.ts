import { DEFAULT_API_URL, normalizeApiBaseUrl, type AccessLevel } from "@watchgoose/mcp-core";

export interface StdioConfig {
  apiKey: string;
  apiUrl: string;
  access: AccessLevel;
  enableWrites: boolean;
}

type Environment = Record<string, string | undefined>;

// hcm_ is reserved for T-152's hosted delegated credentials and is never valid for local stdio.
const RESERVED_HOSTED_KEY_PREFIX = "hcm_";

function parseBoolean(name: string, value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`${name} must be either true or false`);
}

function assertValidApiUrl(value: string): void {
  normalizeApiBaseUrl(value);
}

function isPrefixedKey(key: string, prefix: "hcw_" | "hcr_"): boolean {
  return key.startsWith(prefix) && key.length === 32 && !/\s/.test(key);
}

export function loadConfig(env: Environment): StdioConfig {
  const apiKey = env.WATCHGOOSE_API_KEY;
  if (!apiKey) throw new Error("WATCHGOOSE_API_KEY is required");

  let access: AccessLevel;
  if (isPrefixedKey(apiKey, "hcw_")) {
    access = "read-write";
  } else if (isPrefixedKey(apiKey, "hcr_")) {
    access = "read-only";
  } else if (
    apiKey.length === 32 &&
    !["hcw_", "hcr_", RESERVED_HOSTED_KEY_PREFIX].some((prefix) => apiKey.startsWith(prefix)) &&
    !/\s/.test(apiKey)
  ) {
    const declaredAccess = env.WATCHGOOSE_API_KEY_ACCESS;
    if (declaredAccess !== "read-only" && declaredAccess !== "read-write") {
      throw new Error(
        "WATCHGOOSE_API_KEY_ACCESS must be read-only or read-write for a legacy API key"
      );
    }
    access = declaredAccess;
  } else {
    throw new Error(
      "WATCHGOOSE_API_KEY must be an hcw_ read-write key, an hcr_ read-only key, or a 32-character legacy key"
    );
  }

  const requestedWrites = parseBoolean("WATCHGOOSE_ENABLE_WRITES", env.WATCHGOOSE_ENABLE_WRITES);
  const apiUrl = env.WATCHGOOSE_API_URL || DEFAULT_API_URL;
  assertValidApiUrl(apiUrl);

  return {
    apiKey,
    apiUrl,
    access,
    enableWrites: access === "read-write" && requestedWrites,
  };
}
