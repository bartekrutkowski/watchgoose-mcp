import type { ClientMetadata } from "oidc-provider";
import { ALLOWED_SCOPES, MAX_DCR_BYTES } from "./constants.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

export function validateClientMetadata(metadata: ClientMetadata): void {
  if (Buffer.byteLength(JSON.stringify(metadata)) > MAX_DCR_BYTES) {
    throw new Error("client metadata is too large");
  }
  const name = metadata.client_name;
  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name !== name.trim() ||
    name.length > 200
  ) {
    throw new Error("client_name must contain 1 to 200 characters");
  }
  const redirects = metadata.redirect_uris;
  if (
    !Array.isArray(redirects) ||
    redirects.length === 0 ||
    redirects.length > 10 ||
    !redirects.every(isAllowedRedirectUri) ||
    redirects.reduce((total, uri) => total + uri.length, 0) > 8192
  ) {
    throw new Error("redirect_uris do not satisfy the Watchgoose redirect policy");
  }
  if (metadata.token_endpoint_auth_method !== "none") {
    throw new Error("only public clients are supported");
  }
  const grants = metadata.grant_types;
  if (
    !Array.isArray(grants) ||
    !grants.includes("authorization_code") ||
    grants.some((grant) => grant !== "authorization_code" && grant !== "refresh_token")
  ) {
    throw new Error("only authorization_code and refresh_token grants are supported");
  }
  if (
    !Array.isArray(metadata.response_types) ||
    metadata.response_types.length !== 1 ||
    metadata.response_types[0] !== "code"
  ) {
    throw new Error("response_types must contain only code");
  }
  if (metadata.scope !== undefined) {
    const scopes = metadata.scope.split(" ").filter(Boolean);
    if (
      new Set(scopes).size !== scopes.length ||
      scopes.some((scope) => !ALLOWED_SCOPES.includes(scope as never))
    ) {
      throw new Error("client scope contains an unsupported value");
    }
  }
}

export function validRequestedScopes(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const scopes = value.split(" ").filter(Boolean);
  return (
    scopes.includes("mcp:read") &&
    scopes.length === new Set(scopes).size &&
    scopes.every((scope) => ALLOWED_SCOPES.includes(scope as never))
  );
}

export function isAllowedOrigin(value: string | undefined): boolean {
  if (value === undefined) return true;
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    return false;
  }
  return (
    origin.origin === value &&
    (origin.protocol === "https:" ||
      (origin.protocol === "http:" && LOOPBACK_HOSTS.has(origin.hostname)))
  );
}
