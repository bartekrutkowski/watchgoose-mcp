import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { clientFamily, Logger, parseRequestId, routeCategory, safeLabel } from "./logger.js";

function fakeRequest(headers: Record<string, string | string[]>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe("structured logger", () => {
  it("accepts only short alphanumeric request ids", () => {
    expect(parseRequestId("req-123-ABC")).toBe("req-123-ABC");
    expect(parseRequestId("a".repeat(64))).toBe("a".repeat(64));
    for (const value of [
      undefined,
      "",
      "a".repeat(65),
      "has space",
      "semi;colon",
      "under_score",
      "line\nbreak",
      'quote"',
      "café",
      ["req-1", "req-2"],
    ]) {
      expect(parseRequestId(value)).toBeUndefined();
    }
  });

  it("drops a rejected X-Request-ID and keeps a valid one", () => {
    const lines: string[] = [];
    const logger = new Logger((line) => lines.push(line));
    logger.runRequest(fakeRequest({ "x-request-id": "bad id\n{" }), () => logger.info("one"));
    logger.runRequest(fakeRequest({ "x-request-id": "good-1" }), () => logger.info("two"));
    const [first, second] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(first).not.toHaveProperty("request_id");
    expect(second).toMatchObject({ event: "two", level: "info", request_id: "good-1" });
    expect(lines.every((line) => !line.includes("\n"))).toBe(true);
  });

  it("writes one JSON object per line with ts, level and event first", () => {
    const lines: string[] = [];
    const logger = new Logger((line) => lines.push(line));
    logger.warn("thing_happened", { count: 2, skipped: undefined, ts: "spoofed", level: "x" });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(Object.keys(entry)).toEqual(["ts", "level", "event", "count"]);
    expect(entry).toMatchObject({ level: "warn", event: "thing_happened", count: 2 });
    expect(new Date(entry.ts as string).toISOString()).toBe(entry.ts);
  });

  it("never throws when the sink fails", () => {
    const logger = new Logger(() => {
      throw new Error("disk full");
    });
    expect(() => logger.error("boom")).not.toThrow();
  });

  it("derives short keyed correlation ids", () => {
    const a = new Logger(() => undefined, Buffer.alloc(32, 1));
    const b = new Logger(() => undefined, Buffer.alloc(32, 2));
    const ref = a.ref("grant-id");
    expect(ref).toMatch(/^[0-9a-f]{12}$/);
    expect(a.ref("grant-id")).toBe(ref);
    expect(b.ref("grant-id")).not.toBe(ref);
    expect(a.ref(undefined)).toBeUndefined();
    expect(new Logger(() => undefined).ref("grant-id")).toBeUndefined();
  });

  it("names clients by a bounded label without emails or control characters", () => {
    expect(clientFamily("Claude-User/1.0 (+https://anthropic.com)")).toBe("Claude-User/1.0");
    expect(clientFamily("x".repeat(80))).toBe("x".repeat(40));
    expect(clientFamily("someone@example.com/1.0")).toBe("someone");
    expect(clientFamily(undefined)).toBe("unknown");
    expect(clientFamily("10.0.0.1/agent")).toBe("[redacted]/agent");
    expect(clientFamily("(weird)")).toBe("unknown");
    expect(safeLabel("Claude\nInjected", 60)).toBe("Claude Injected");
    expect(safeLabel("Bot of owner@example.com", 60)).toBe("Bot of [redacted]");
    expect(safeLabel("origin http://203.0.113.9 not allowed", 60)).toBe(
      "origin http://[redacted] not allowed"
    );
    expect(safeLabel("n".repeat(70), 60)).toHaveLength(60);
    expect(safeLabel(42, 60)).toBeUndefined();
  });

  it("keeps the client name per request", () => {
    const lines: string[] = [];
    const logger = new Logger((line) => lines.push(line));
    logger.runRequest(fakeRequest({}), () => {
      logger.setClientName("ChatGPT");
      logger.info("inside", { client_name: logger.clientName() });
    });
    logger.info("outside", { client_name: logger.clientName() });
    expect(lines.map((line) => JSON.parse(line) as Record<string, unknown>)).toEqual([
      expect.objectContaining({ event: "inside", client_name: "ChatGPT" }),
      expect.not.objectContaining({ client_name: expect.anything() }),
    ]);
  });

  it("categorizes routes", () => {
    expect(routeCategory("/mcp")).toBe("mcp");
    expect(routeCategory("/authorize")).toBe("oauth_authorize");
    expect(routeCategory("/token")).toBe("oauth_token");
    expect(routeCategory("/register")).toBe("oauth_register");
    expect(routeCategory("/oauth/callback")).toBe("oauth_callback");
    expect(routeCategory("/.well-known/oauth-authorization-server")).toBe("oauth_discovery");
    expect(routeCategory("/.well-known/oauth-protected-resource/mcp")).toBe("oauth_discovery");
    expect(routeCategory("/healthz")).toBe("health");
    expect(routeCategory("/internal/prune")).toBe("other");
    expect(routeCategory("/anything")).toBe("other");
  });
});
