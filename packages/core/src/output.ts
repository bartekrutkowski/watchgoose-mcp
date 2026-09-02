import type { CallToolResult } from "@modelcontextprotocol/server";
import { MAX_SERIALIZED_OUTPUT_CHARS } from "./constants.js";

export type ToolResult = CallToolResult;

function result(text: string, isError = false, structuredContent?: unknown): ToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent === undefined ? {} : { structuredContent }),
    ...(isError ? { isError: true } : {}),
  };
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeJsonNumbers(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalizeJsonNumbers);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeJsonNumbers(item)])
    );
  }
  return value;
}

function structuredResult(value: unknown): ToolResult {
  const structuredContent = normalizeJsonNumbers(value);
  return result(serialize(structuredContent), false, structuredContent);
}

interface ShortenedValue {
  value: unknown;
  truncated: boolean;
}

const TRUNCATABLE_STRING_FIELDS = new Set([
  "desc",
  "tags",
  "subject",
  "subject_fail",
  "start_kw",
  "success_kw",
  "failure_kw",
]);

function shortenStrings(value: unknown, maxLength: number, field?: string): ShortenedValue {
  if (typeof value === "string") {
    return field !== undefined && TRUNCATABLE_STRING_FIELDS.has(field) && value.length > maxLength
      ? { value: `${value.slice(0, maxLength - 3)}...`, truncated: true }
      : { value, truncated: false };
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => shortenStrings(item, maxLength, field));
    return {
      value: items.map((item) => item.value),
      truncated: items.some((item) => item.truncated),
    };
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).map(
      ([key, item]) => [key, shortenStrings(item, maxLength, key)] as const
    );
    return {
      value: Object.fromEntries(entries.map(([key, item]) => [key, item.value])),
      truncated: entries.some(([, item]) => item.truncated),
    };
  }
  return { value, truncated: false };
}

export function listToolResult(
  key: string,
  allItems: unknown[],
  requestedLimit: number
): ToolResult {
  const originalSelection = allItems.slice(0, requestedLimit);
  let selected = originalSelection;
  let selectedTruncations = selected.map(() => false);
  const total = allItems.length;
  const makePayload = (items: unknown[], truncatedFields: boolean) => ({
    [key]: items,
    meta: {
      returned: items.length,
      available_in_response: total,
      omitted: total - items.length,
      truncated: items.length < total || truncatedFields,
      ...(truncatedFields ? { truncated_fields: true } : {}),
    },
  });

  let text = serialize(makePayload(selected, false));
  if (text.length <= MAX_SERIALIZED_OUTPUT_CHARS)
    return structuredResult(makePayload(selected, false));

  let truncatedFields = false;
  for (const maxLength of [4_000, 2_000, 1_000, 500, 200, 100, 50, 25]) {
    const shortened = originalSelection.map((item) => shortenStrings(item, maxLength));
    selected = shortened.map((item) => item.value);
    selectedTruncations = shortened.map((item) => item.truncated);
    truncatedFields = selectedTruncations.some(Boolean);
    text = serialize(makePayload(selected, truncatedFields));
    if (text.length <= MAX_SERIALIZED_OUTPUT_CHARS) {
      return structuredResult(makePayload(selected, truncatedFields));
    }
  }

  while (text.length > MAX_SERIALIZED_OUTPUT_CHARS && selected.length > 0) {
    selected.pop();
    selectedTruncations.pop();
    truncatedFields = selectedTruncations.some(Boolean);
    text = serialize(makePayload(selected, truncatedFields));
  }

  return structuredResult(makePayload(selected, truncatedFields));
}

export function objectToolResult(key: string, value: Record<string, unknown>): ToolResult {
  let payload: Record<string, unknown> = { [key]: value };
  let text = serialize(payload);
  if (text.length <= MAX_SERIALIZED_OUTPUT_CHARS) return structuredResult(payload);

  for (const maxLength of [4_000, 2_000, 1_000, 500, 200, 100, 50, 25]) {
    const shortened = shortenStrings(value, maxLength);
    payload = {
      [key]: shortened.value,
      ...(shortened.truncated ? { meta: { truncated_fields: true } } : {}),
    };
    text = serialize(payload);
    if (text.length <= MAX_SERIALIZED_OUTPUT_CHARS) return structuredResult(payload);
  }

  return result("Watchgoose returned more data than this MCP tool can safely display.", true);
}

export function errorToolResult(message: string): ToolResult {
  return result(message, true);
}
