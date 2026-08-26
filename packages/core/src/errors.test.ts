import { describe, expect, it } from "vitest";
import {
  ApiCancelledError,
  ApiNetworkError,
  ApiResponseError,
  ApiTimeoutError,
  ChannelResolutionError,
  InvalidApiResponseError,
  mapToolError,
} from "./errors.js";

describe("mapToolError", () => {
  it.each([
    [400, undefined, "rejected the request"],
    [401, undefined, "rejected the API credential"],
    [403, undefined, "denied access"],
    [403, "This project reached check limit.", "reached its check limit"],
    [404, undefined, "Check not found"],
    [409, undefined, "must be paused"],
    [429, undefined, "Back off"],
    [503, undefined, "temporarily unavailable"],
  ])("maps HTTP %i without relaying response data", (status, detail, expected) => {
    expect(mapToolError(new ApiResponseError(status, detail))).toContain(expected);
  });

  it("never includes arbitrary API details", () => {
    const sentinel = `hcw_${"secret".repeat(5)}`;
    expect(mapToolError(new ApiResponseError(400, sentinel))).not.toContain(sentinel);
  });

  it("includes a server-provided retry delay in 429 guidance", () => {
    expect(mapToolError(new ApiResponseError(429, undefined, 360))).toContain(
      "Back off and retry in 360 seconds"
    );
  });

  it.each([
    [new ApiTimeoutError(), "did not respond within 30 seconds"],
    [new ApiCancelledError(), "request was cancelled"],
    [new ApiNetworkError(), "Could not reach the Watchgoose API"],
    [new InvalidApiResponseError(), "unexpected response"],
    [new ChannelResolutionError("missing"), "Integration not found"],
    [new ChannelResolutionError("duplicate"), "matches more than once"],
    [new ChannelResolutionError("empty"), "must not be empty"],
  ])("maps non-HTTP failures to actionable messages", (error, expected) => {
    expect(mapToolError(error)).toContain(expected);
  });
});
