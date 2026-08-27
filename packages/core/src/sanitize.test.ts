import { describe, expect, it } from "vitest";
import { MAX_SERIALIZED_OUTPUT_CHARS } from "./constants.js";
import { listToolResult, objectToolResult } from "./output.js";
import { deriveUniqueKey, sanitizeCheck, sanitizePing } from "./sanitize.js";

const UUID = "12345678-1234-5678-9234-567812345678";

describe("output sanitization", () => {
  it("derives stable unique keys and strips capability fields", async () => {
    expect(await deriveUniqueKey(UUID)).toBe("22fcf0cd2cf07841d4214d6a14b2b28c1e15be24");
    const check = await sanitizeCheck(
      {
        uuid: UUID,
        name: "Backup",
        status: "up",
        channels: "channel-secret",
        ping_url: "https://secret/ping",
        update_url: "https://secret/update",
        future_private_field: "sentinel",
      },
      new Map([["channel-secret", { name: "Ops email", kind: "email" }]])
    );
    expect(check).toEqual({
      unique_key: "22fcf0cd2cf07841d4214d6a14b2b28c1e15be24",
      name: "Backup",
      status: "up",
      channels: [{ name: "Ops email", kind: "email" }],
    });
  });

  it("pins write-derived and readonly-origin unique keys to the same value", async () => {
    const readonly = await sanitizeCheck({
      unique_key: "22fcf0cd2cf07841d4214d6a14b2b28c1e15be24",
    });
    const writable = await sanitizeCheck({ uuid: UUID });
    expect(writable.unique_key).toBe(readonly.unique_key);
  });

  it("allowlists ping fields", () => {
    expect(
      sanitizePing({
        type: "success",
        date: "2026-08-22T10:00:00Z",
        n: 4,
        scheme: "https",
        method: "POST",
        duration: 2.5,
        remote_addr: "192.0.2.1",
        ua: "secret-agent",
        rid: "secret-run",
        body_url: "https://secret/body",
        future: "sentinel",
      })
    ).toEqual({
      type: "success",
      date: "2026-08-22T10:00:00Z",
      n: 4,
      scheme: "https",
      method: "POST",
      duration: 2.5,
    });
  });

  it("shortens verbose list fields before omitting records", () => {
    const items = Array.from({ length: 100 }, (_, index) => ({
      index,
      desc: "x".repeat(2_000),
    }));
    const result = listToolResult("checks", items, 100);
    const text = result.content[0]!.type === "text" ? result.content[0]!.text : "";
    expect(text.length).toBeLessThanOrEqual(MAX_SERIALIZED_OUTPUT_CHARS);
    const parsed = JSON.parse(text) as {
      checks: Array<{ desc: string }>;
      meta: { returned: number; omitted: number; truncated: boolean; truncated_fields: boolean };
    };
    expect(parsed.checks).toHaveLength(100);
    expect(parsed.checks.every((check) => check.desc.length <= 200)).toBe(true);
    expect(parsed.meta.returned).toBe(100);
    expect(parsed.meta.omitted).toBe(0);
    expect(parsed.meta.truncated).toBe(true);
    expect(parsed.meta.truncated_fields).toBe(true);
  });

  it.each([
    [3, 10_000],
    [1, 25_000],
  ])("keeps %i checks with %i-character descriptions", (count, descLength) => {
    const result = listToolResult(
      "checks",
      Array.from({ length: count }, (_, index) => ({ index, desc: "x".repeat(descLength) })),
      100
    );
    const text = result.content[0]!.type === "text" ? result.content[0]!.text : "";
    const parsed = JSON.parse(text) as {
      checks: unknown[];
      meta: { returned: number; omitted: number; truncated_fields: boolean };
    };
    expect(text.length).toBeLessThanOrEqual(MAX_SERIALIZED_OUTPUT_CHARS);
    expect(parsed.checks).toHaveLength(count);
    expect(parsed.meta).toMatchObject({ returned: count, omitted: 0, truncated_fields: true });
  });

  it("applies the requested item cap after preserving records", () => {
    const result = listToolResult(
      "checks",
      Array.from({ length: 150 }, (_, index) => ({ index })),
      100
    );
    const text = result.content[0]!.type === "text" ? result.content[0]!.text : "";
    const parsed = JSON.parse(text) as {
      checks: unknown[];
      meta: { returned: number; omitted: number; truncated: boolean };
    };
    expect(parsed.checks).toHaveLength(100);
    expect(parsed.meta).toEqual({
      returned: 100,
      available_in_response: 150,
      omitted: 50,
      truncated: true,
    });
  });

  it("does not claim field truncation when only records are omitted", () => {
    const result = listToolResult(
      "checks",
      Array.from({ length: 100 }, (_, index) => ({ index, values: Array(1_000).fill(1) })),
      100
    );
    const text = result.content[0]!.type === "text" ? result.content[0]!.text : "";
    const parsed = JSON.parse(text) as {
      checks: unknown[];
      meta: { omitted: number; truncated: boolean; truncated_fields?: boolean };
    };
    expect(parsed.checks.length).toBeGreaterThan(0);
    expect(parsed.meta.omitted).toBeGreaterThan(0);
    expect(parsed.meta.truncated).toBe(true);
    expect(parsed.meta.truncated_fields).toBeUndefined();
  });

  it("never shortens unique keys when verbose records must be omitted", () => {
    const result = listToolResult(
      "checks",
      Array.from({ length: 100 }, (_, index) => ({
        unique_key: index.toString(16).padStart(40, "0"),
        name: `Check ${index} ${"n".repeat(80)}`,
        slug: `check-${index}-${"s".repeat(80)}`,
        desc: "d".repeat(10_000),
        tags: "t".repeat(500),
        start_kw: "a".repeat(200),
        success_kw: "b".repeat(200),
        failure_kw: "c".repeat(200),
      })),
      100
    );
    const text = result.content[0]!.type === "text" ? result.content[0]!.text : "";
    const parsed = JSON.parse(text) as {
      checks: Array<{ unique_key: string }>;
      meta: { omitted: number; truncated_fields: boolean };
    };
    expect(text.length).toBeLessThanOrEqual(MAX_SERIALIZED_OUTPUT_CHARS);
    expect(parsed.checks.length).toBeGreaterThan(0);
    expect(parsed.checks.every((check) => /^[0-9a-f]{40}$/.test(check.unique_key))).toBe(true);
    expect(parsed.meta.truncated_fields).toBe(true);
  });

  it("clears field-truncation metadata when every shortened record is omitted", () => {
    const result = listToolResult(
      "checks",
      [
        { unique_key: "0".repeat(40), values: Array(11_900).fill(1) },
        ...Array.from({ length: 10 }, (_, index) => ({
          unique_key: (index + 1).toString(16).padStart(40, "0"),
          desc: "d".repeat(10_000),
        })),
      ],
      100
    );
    const text = result.content[0]!.type === "text" ? result.content[0]!.text : "";
    const parsed = JSON.parse(text) as {
      checks: unknown[];
      meta: { omitted: number; truncated_fields?: boolean };
    };
    expect(text.length).toBeLessThanOrEqual(MAX_SERIALIZED_OUTPUT_CHARS);
    expect(parsed.checks).toHaveLength(1);
    expect(parsed.meta.omitted).toBe(10);
    expect(parsed.meta.truncated_fields).toBeUndefined();
  });

  it("caps oversized single-object output", () => {
    const result = objectToolResult("check", { desc: "x".repeat(30_000) });
    const text = result.content[0]!.type === "text" ? result.content[0]!.text : "";
    expect(text.length).toBeLessThanOrEqual(MAX_SERIALIZED_OUTPUT_CHARS);
    expect(text).toContain("truncated_fields");
  });

  it.each([23_999, 24_000])("preserves a %i-character serialized result", (length) => {
    const overhead = JSON.stringify({ check: { desc: "" } }).length;
    const result = objectToolResult("check", { desc: "x".repeat(length - overhead) });
    const text = result.content[0]!.type === "text" ? result.content[0]!.text : "";
    expect(text).toHaveLength(length);
    expect(text).not.toContain("truncated_fields");
  });

  it("truncates a 24,001-character serialized result", () => {
    const overhead = JSON.stringify({ check: { desc: "" } }).length;
    const result = objectToolResult("check", { desc: "x".repeat(24_001 - overhead) });
    const text = result.content[0]!.type === "text" ? result.content[0]!.text : "";
    expect(text.length).toBeLessThanOrEqual(MAX_SERIALIZED_OUTPUT_CHARS);
    expect(text).toContain("truncated_fields");
  });
});
