import type { ClientMetadata } from "oidc-provider";
import { ALLOWED_SCOPES, MAX_DCR_BYTES, MCP_SCOPES } from "./constants.js";

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

// Google Connected Apps (Gemini) account-linking redirect hosts. Paths are
// /r/<project> (redirect) or /a/<project> (app flip).
const GOOGLE_REDIRECT_HOSTS = new Set([
  "oauth-redirect.googleusercontent.com",
  "oauth-redirect-sandbox.googleusercontent.com",
  "oauth-redirect-test.googleusercontent.com",
]);
export const GOOGLE_CLIENT_NAME = "Gemini";

function isGoogleRedirectUri(value: unknown): boolean {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    GOOGLE_REDIRECT_HOSTS.has(url.hostname) &&
    /^\/[ra]\/[^/]/.test(url.pathname)
  );
}

// True only when every redirect URI belongs to Google's account linking, so a
// client cannot mix in another redirect and inherit Google-specific handling.
export function isGoogleClient(redirectUris: unknown): boolean {
  return (
    Array.isArray(redirectUris) &&
    redirectUris.length > 0 &&
    redirectUris.every(isGoogleRedirectUri)
  );
}

function knownScopes(value: string): string[] {
  return [...new Set(value.split(" ").filter((scope) => ALLOWED_SCOPES.includes(scope as never)))];
}

// Write access is only usable together with read access (every authorization
// must include mcp:read), so a scope list with mcp:write also gets mcp:read.
function withReadImplied(scopes: string[]): string[] {
  return scopes.includes("mcp:write") && !scopes.includes("mcp:read")
    ? ["mcp:read", ...scopes]
    : scopes;
}

// RFC 7591 lets the server substitute registration values. Unknown scopes
// (e.g. openid) are dropped instead of failing registration; Gemini, whose
// request shape is undocumented, gets a fixed name when it sends none, is
// registered as a public client whatever auth method it asks for, and always
// gets the refresh_token grant. The response tells the client what was
// registered.
export function normaliseRegistration(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  if (typeof out.scope === "string") {
    const scopes = withReadImplied(knownScopes(out.scope));
    if (scopes.length > 0) out.scope = scopes.join(" ");
    else delete out.scope;
  }
  if (isGoogleClient(out.redirect_uris)) {
    if (typeof out.client_name !== "string" || out.client_name.trim().length === 0) {
      out.client_name = GOOGLE_CLIENT_NAME;
    }
    if (out.token_endpoint_auth_method !== undefined) out.token_endpoint_auth_method = "none";
    // Without the refresh_token grant no refresh token is issued and the link
    // would end with its one-hour access token.
    if (
      Array.isArray(out.grant_types) &&
      out.grant_types.includes("authorization_code") &&
      !out.grant_types.includes("refresh_token")
    ) {
      out.grant_types = [...(out.grant_types as unknown[]), "refresh_token"];
    }
  }
  return out;
}

// Fills authorization parameters a client may omit: the resource defaults to
// our only protected resource, unknown scopes (openid, profile, email) are
// dropped, and a request with no MCP scope asks for every scope the client
// registered (every advertised scope when it registered none). mcp:read is
// added to a write request only where the registration allows it, so a
// registered limit is never exceeded. The Watchgoose consent page still
// decides read-only or read and write.
export function normaliseAuthorizationParams(
  params: URLSearchParams,
  resource: string,
  registeredScope?: string
): void {
  if (!params.has("resource")) params.set("resource", resource);
  const permitted =
    registeredScope === undefined ? [...ALLOWED_SCOPES] : knownScopes(registeredScope);
  const scopes = knownScopes(params.get("scope") ?? "");
  if (!scopes.some((scope) => MCP_SCOPES.includes(scope as never))) {
    params.set("scope", permitted.join(" "));
    return;
  }
  if (!scopes.includes("mcp:read") && permitted.includes("mcp:read")) scopes.unshift("mcp:read");
  params.set("scope", scopes.join(" "));
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
