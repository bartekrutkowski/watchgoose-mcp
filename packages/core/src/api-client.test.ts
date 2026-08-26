import { describe, expect, it, vi } from "vitest";
import { WatchgooseApiClient } from "./api-client.js";
import {
  ApiCancelledError,
  ApiResponseError,
  ApiTimeoutError,
  InvalidApiResponseError,
} from "./errors.js";
import { MAX_RESPONSE_BYTES } from "./constants.js";

const API_KEY = `hcw_${"s".repeat(28)}`;

function client(fetchFn: typeof fetch, timeoutMs = 100): WatchgooseApiClient {
  return new WatchgooseApiClient({
    apiKey: API_KEY,
    apiUrl: "https://watchgoose.test/api/v3",
    fetch: fetchFn,
    timeoutMs,
  });
}

describe("WatchgooseApiClient", () => {
  it("sends only allowlisted headers and rejects redirects", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect([...headers.keys()].sort()).toEqual(["accept", "content-type", "x-api-key"]);
      expect(headers.get("x-api-key")).toBe(API_KEY);
      expect(init?.redirect).toBe("error");
      return Response.json({ ok: true });
    });

    await expect(client(fetchFn).request("checks/", { method: "POST", body: {} })).resolves.toEqual(
      { ok: true }
    );
  });

  it("does not invoke fetch for a pre-cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn<typeof fetch>();
    await expect(
      client(fetchFn).request("checks/", { signal: controller.signal })
    ).rejects.toBeInstanceOf(ApiCancelledError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("keeps the timeout active while reading the response body", async () => {
    const fetchFn: typeof fetch = async (_input, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
        },
      });
      return new Response(stream, { status: 200 });
    };
    await expect(client(fetchFn, 20).request("checks/")).rejects.toBeInstanceOf(ApiTimeoutError);
  });

  it("rejects oversized and malformed responses", async () => {
    const oversized: typeof fetch = async () =>
      new Response("", { headers: { "Content-Length": String(MAX_RESPONSE_BYTES + 1) } });
    await expect(client(oversized).request("checks/")).rejects.toBeInstanceOf(
      InvalidApiResponseError
    );

    const malformed: typeof fetch = async () => new Response("not-json");
    await expect(client(malformed).request("checks/")).rejects.toBeInstanceOf(
      InvalidApiResponseError
    );
  });

  it("retains only bounded API error metadata", async () => {
    const fetchFn: typeof fetch = async () =>
      Response.json(
        { error: "This project reached check limit.", ignored: API_KEY },
        { status: 403, headers: { "Retry-After": "360" } }
      );
    const promise = client(fetchFn).request("checks/");
    await expect(promise).rejects.toMatchObject({
      status: 403,
      detail: "This project reached check limit.",
      retryAfterSeconds: 360,
    });
    await expect(promise).rejects.toBeInstanceOf(ApiResponseError);
  });

  it.each([
    ["0", 1],
    ["999999999", 3_600],
  ])("clamps a Retry-After value of %s to %i seconds", async (retryAfter, expected) => {
    const fetchFn: typeof fetch = async () =>
      Response.json(
        { error: "rate limited" },
        { status: 429, headers: { "Retry-After": retryAfter } }
      );
    await expect(client(fetchFn).request("checks/")).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: expected,
    });
  });

  it.each([
    ["Sat, 22 Aug 2026 12:01:00 GMT", 60],
    ["Sat, 22 Aug 2026 14:00:00 GMT", 3_600],
  ])("converts and clamps an HTTP-date Retry-After value", async (retryAfter, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00Z"));
    try {
      const fetchFn: typeof fetch = async () =>
        Response.json(
          { error: "rate limited" },
          { status: 429, headers: { "Retry-After": retryAfter } }
        );
      await expect(client(fetchFn).request("checks/")).rejects.toMatchObject({
        status: 429,
        retryAfterSeconds: expected,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
