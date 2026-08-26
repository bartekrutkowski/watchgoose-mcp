import { InvalidApiResponseError } from "./errors.js";

export interface SanitizedChannel {
  name: string;
  kind: string;
}

export type ChannelById = ReadonlyMap<string, SanitizedChannel>;

const SAFE_CHECK_FIELDS = [
  "name",
  "slug",
  "tags",
  "desc",
  "grace",
  "n_pings",
  "status",
  "started",
  "last_ping",
  "next_ping",
  "last_duration",
  "manual_resume",
  "methods",
  "subject",
  "subject_fail",
  "start_kw",
  "success_kw",
  "failure_kw",
  "filter_subject",
  "filter_body",
  "filter_http_body",
  "filter_default_fail",
  "timeout",
  "schedule",
  "tz",
] as const;

function isSafeScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

export async function deriveUniqueKey(uuid: string): Promise<string> {
  const compact = uuid.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) {
    throw new InvalidApiResponseError();
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(compact.slice(0, 16))
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sanitizeCheck(
  record: Record<string, unknown>,
  channelsById?: ChannelById
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  const suppliedUniqueKey = record.unique_key;
  if (typeof suppliedUniqueKey === "string" && /^[0-9a-f]{40}$/.test(suppliedUniqueKey)) {
    result.unique_key = suppliedUniqueKey;
  } else {
    const uuid = typeof record.uuid === "string" ? record.uuid : record.code;
    if (typeof uuid !== "string") throw new InvalidApiResponseError();
    result.unique_key = await deriveUniqueKey(uuid);
  }

  for (const field of SAFE_CHECK_FIELDS) {
    const value = record[field];
    if (isSafeScalar(value)) result[field] = value;
  }

  if (channelsById && typeof record.channels === "string") {
    result.channels = record.channels
      .split(",")
      .filter(Boolean)
      .map((id) => channelsById.get(id))
      .filter((channel): channel is SanitizedChannel => channel !== undefined);
  }

  return result;
}

export function sanitizePing(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of ["type", "date", "n", "scheme", "method", "duration"] as const) {
    const value = record[field];
    if (isSafeScalar(value)) result[field] = value;
  }
  return result;
}

export function sanitizeFlip(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of ["timestamp", "up"] as const) {
    const value = record[field];
    if (isSafeScalar(value)) result[field] = value;
  }
  return result;
}

export function sanitizeChannel(record: Record<string, unknown>): SanitizedChannel | undefined {
  if (typeof record.name !== "string" || typeof record.kind !== "string") return undefined;
  return { name: record.name, kind: record.kind };
}
