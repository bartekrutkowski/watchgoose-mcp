import { describe, expect, it } from "vitest";
import { parseEncryptionKey } from "./config.js";
import { deriveKey } from "./crypto.js";
import { isAllowedRedirectUri, validateClientMetadata } from "./security.js";

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
