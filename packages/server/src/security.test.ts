import { describe, expect, it } from "vitest";
import { parseEncryptionKey, parseGoogleConnectedAppsToken } from "./config.js";
import { deriveKey } from "./crypto.js";
import {
  isAllowedRedirectUri,
  isGoogleClient,
  normaliseAuthorizationParams,
  normaliseRegistration,
  validateClientMetadata,
} from "./security.js";

describe("server security policy", () => {
  it.each([
    "https://client.example/callback",
    "http://localhost:49152/callback",
    "http://127.0.0.1:1/callback",
    "http://[::1]:65535/callback",
  ])("accepts safe DCR redirect %s", (value) => {
    expect(isAllowedRedirectUri(value)).toBe(true);
  });

  it.each([
    "http://client.example/callback",
    "custom://callback",
    "https://user@client.example/callback",
    "https://client.example/callback#fragment",
    "http://127.0.0.2:1234/callback",
  ])("rejects unsafe DCR redirect %s", (value) => {
    expect(isAllowedRedirectUri(value)).toBe(false);
  });

  it("caps client metadata", () => {
    expect(() =>
      validateClientMetadata({
        client_id: "client",
        client_name: "Claude Code",
        redirect_uris: Array.from({ length: 11 }, (_, i) => `https://client.example/${i}`),
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      })
    ).toThrow();
  });

  it("rejects client names that Django would normalize", () => {
    expect(() =>
      validateClientMetadata({
        client_id: "client",
        client_name: " Claude Code ",
        redirect_uris: ["http://127.0.0.1:49152/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      })
    ).toThrow();
  });

  it("accepts only exactly 32-byte encoded encryption keys", () => {
    const key = Buffer.alloc(32, 0xab);
    expect(parseEncryptionKey(key.toString("hex"))).toEqual(key);
    expect(parseEncryptionKey(key.toString("base64"))).toEqual(key);
    expect(() => parseEncryptionKey(Buffer.alloc(31).toString("hex"))).toThrow();
    expect(() => parseEncryptionKey(`${key.toString("base64")}junk`)).toThrow();
  });

  it("domain-separates the SQLite AES key from the root key", () => {
    const root = Buffer.alloc(32, 0xab);
    const stateKey = deriveKey(root, "sqlite-state-encryption");
    expect(stateKey).toHaveLength(32);
    expect(stateKey).not.toEqual(root);
    expect(stateKey).not.toEqual(deriveKey(root, "cookie-signing"));
  });
});

describe("Google Connected Apps compatibility", () => {
  it.each([
    [["https://oauth-redirect.googleusercontent.com/r/project"], true],
    [["https://oauth-redirect-sandbox.googleusercontent.com/a/project"], true],
    [["https://oauth-redirect-test.googleusercontent.com/r/project"], true],
    [["https://oauth-redirect.googleusercontent.com/x/project"], false],
    [["https://oauth-redirect.googleusercontent.com/r/"], false],
    [["http://oauth-redirect.googleusercontent.com/r/project"], false],
    [["https://oauth-redirect.googleusercontent.com:8443/r/project"], false],
    [["https://evil.googleusercontent.com/r/project"], false],
    [["https://oauth-redirect.googleusercontent.com/r/p", "https://client.example/cb"], false],
    [[], false],
    ["https://oauth-redirect.googleusercontent.com/r/project", false],
  ])("treats %j as Google: %s", (uris, expected) => {
    expect(isGoogleClient(uris)).toBe(expected);
  });

  it("accepts only a Google verification file as GOOGLE_CONNECTED_APPS_TOKEN", () => {
    const file = '{"verification_tokens":["abc"]}';
    expect(parseGoogleConnectedAppsToken(file)).toBe(file);
    for (const value of [
      "{verification_tokens:[abc]}",
      "abc",
      "null",
      "[]",
      "{}",
      '{"verification_tokens":[]}',
      '{"verification_tokens":[""]}',
      '{"verification_tokens":"abc"}',
    ]) {
      expect(() => parseGoogleConnectedAppsToken(value), value).toThrow(
        "GOOGLE_CONNECTED_APPS_TOKEN must be the JSON contents of google-connected-apps.json"
      );
    }
  });

  it("normalises registrations without changing other clients' names or auth", () => {
    expect(
      normaliseRegistration({
        redirect_uris: ["https://oauth-redirect.googleusercontent.com/r/p"],
        token_endpoint_auth_method: "client_secret_post",
        scope: "openid mcp:read mcp:read",
      })
    ).toEqual({
      redirect_uris: ["https://oauth-redirect.googleusercontent.com/r/p"],
      client_name: "Gemini",
      token_endpoint_auth_method: "none",
      scope: "mcp:read",
    });
    expect(
      normaliseRegistration({
        redirect_uris: ["https://oauth-redirect.googleusercontent.com/r/p"],
        grant_types: ["authorization_code"],
      }).grant_types
    ).toEqual(["authorization_code", "refresh_token"]);
    expect(
      normaliseRegistration({
        redirect_uris: ["https://client.example/cb"],
        grant_types: ["authorization_code"],
      }).grant_types
    ).toEqual(["authorization_code"]);
    const other = {
      redirect_uris: ["https://client.example/cb"],
      token_endpoint_auth_method: "client_secret_post",
      scope: "openid",
    };
    expect(normaliseRegistration(other)).toEqual({
      redirect_uris: ["https://client.example/cb"],
      token_endpoint_auth_method: "client_secret_post",
    });
  });

  it.each([
    ["scope=mcp:read+offline_access", "mcp:read offline_access"],
    ["", "mcp:read mcp:write offline_access"],
    ["scope=openid+profile+email", "mcp:read mcp:write offline_access"],
    ["scope=mcp:write", "mcp:read mcp:write"],
    ["scope=mcp:read+mcp:read+bogus", "mcp:read"],
  ])("normalises authorization %s", (query, scope) => {
    const params = new URLSearchParams(query);
    normaliseAuthorizationParams(params, "https://mcp.example/mcp");
    expect(params.get("scope")).toBe(scope);
    expect(params.get("resource")).toBe("https://mcp.example/mcp");
  });

  it.each([
    ["mcp:read offline_access", "", "mcp:read offline_access"],
    ["mcp:read", "scope=openid", "mcp:read"],
    // Write beyond the registration is left for the provider to reject.
    ["mcp:read", "scope=mcp:write", "mcp:read mcp:write"],
    // A legacy write-only registration gets no read it never registered.
    ["mcp:read mcp:write", "scope=mcp:write", "mcp:read mcp:write"],
    ["mcp:write", "scope=mcp:write", "mcp:write"],
  ])("stays within registered scope %s for %s", (registered, query, scope) => {
    const params = new URLSearchParams(query);
    normaliseAuthorizationParams(params, "https://mcp.example/mcp", registered);
    expect(params.get("scope")).toBe(scope);
  });

  it("registers write access with read access implied", () => {
    expect(normaliseRegistration({ scope: "mcp:write offline_access" })).toEqual({
      scope: "mcp:read mcp:write offline_access",
    });
  });

  it("keeps a resource the client sent, so a wrong one is still rejected", () => {
    const params = new URLSearchParams("resource=https://other.example/mcp&scope=mcp:read");
    normaliseAuthorizationParams(params, "https://mcp.example/mcp");
    expect(params.getAll("resource")).toEqual(["https://other.example/mcp"]);
  });
});
