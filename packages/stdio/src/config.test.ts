import { describe, expect, it } from "vitest";
import { DEFAULT_API_URL } from "@watchgoose/mcp-core";
import { loadConfig } from "./config.js";

const RW_KEY = `hcw_${"a".repeat(28)}`;
const RO_KEY = `hcr_${"b".repeat(28)}`;
const LEGACY_KEY = `hc${"c".repeat(30)}`;

describe("loadConfig", () => {
  it("requires an API key", () => {
    expect(() => loadConfig({})).toThrow("WATCHGOOSE_API_KEY is required");
  });

  it("classifies prefixed keys without probing", () => {
    expect(loadConfig({ WATCHGOOSE_API_KEY: RW_KEY })).toEqual({
      apiKey: RW_KEY,
      apiUrl: DEFAULT_API_URL,
      access: "read-write",
      enableWrites: false,
    });
    expect(loadConfig({ WATCHGOOSE_API_KEY: RO_KEY, WATCHGOOSE_ENABLE_WRITES: "true" })).toEqual({
      apiKey: RO_KEY,
      apiUrl: DEFAULT_API_URL,
      access: "read-only",
      enableWrites: false,
    });
  });

  it("requires an access declaration for every legacy key", () => {
    expect(() => loadConfig({ WATCHGOOSE_API_KEY: LEGACY_KEY })).toThrow(
      "WATCHGOOSE_API_KEY_ACCESS"
    );
    expect(
      loadConfig({
        WATCHGOOSE_API_KEY: LEGACY_KEY,
        WATCHGOOSE_API_KEY_ACCESS: "read-write",
        WATCHGOOSE_ENABLE_WRITES: "true",
      })
    ).toMatchObject({ access: "read-write", enableWrites: true });
  });

  it("rejects MCP delegation keys and malformed configuration", () => {
    expect(() =>
      loadConfig({
        WATCHGOOSE_API_KEY: `hcm_${"d".repeat(28)}`,
        WATCHGOOSE_API_KEY_ACCESS: "read-write",
      })
    ).toThrow("WATCHGOOSE_API_KEY must be");
    expect(() => loadConfig({ WATCHGOOSE_API_KEY: RW_KEY, WATCHGOOSE_ENABLE_WRITES: "1" })).toThrow(
      "must be either true or false"
    );
  });

  it("validates the custom API URL without including its value in errors", () => {
    expect(() =>
      loadConfig({ WATCHGOOSE_API_KEY: RW_KEY, WATCHGOOSE_API_URL: "secret-value" })
    ).toThrow("absolute HTTP or HTTPS URL");
    expect(() =>
      loadConfig({
        WATCHGOOSE_API_KEY: RW_KEY,
        WATCHGOOSE_API_URL: "https://user:password@example.com/api/v3",
      })
    ).toThrow("must not contain credentials");
    expect(() =>
      loadConfig({ WATCHGOOSE_API_KEY: RW_KEY, WATCHGOOSE_API_URL: "http://example.com/api/v3" })
    ).toThrow("must use HTTPS unless it targets a loopback host");
    expect(
      loadConfig({ WATCHGOOSE_API_KEY: RW_KEY, WATCHGOOSE_API_URL: "http://127.0.0.1:8000/api/v3" })
        .apiUrl
    ).toBe("http://127.0.0.1:8000/api/v3");
  });
});
