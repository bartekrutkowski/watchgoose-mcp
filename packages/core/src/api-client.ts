import {
  ApiCancelledError,
  ApiNetworkError,
  ApiResponseError,
  ApiTimeoutError,
  InvalidApiResponseError,
} from "./errors.js";
import { DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES } from "./constants.js";

export interface ApiClientOptions {
  apiKey: string;
  apiUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown> | undefined;
  signal?: AbortSignal | undefined;
}

export function normalizeApiBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("WATCHGOOSE_API_URL must be an absolute HTTP or HTTPS URL");
  }

  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopbackHosts.has(url.hostname))) {
    throw new Error("WATCHGOOSE_API_URL must use HTTPS unless it targets a loopback host");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("WATCHGOOSE_API_URL must not contain credentials, a query, or a fragment");
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url;
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new InvalidApiResponseError();
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new InvalidApiResponseError();
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function parseErrorDetail(text: string): string | undefined {
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "string" &&
      parsed.error.length <= 500
    ) {
      return parsed.error;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function clampRetryAfter(seconds: number): number {
  return Math.min(Math.max(seconds, 1), 3_600);
}

function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) ? clampRetryAfter(seconds) : undefined;
  }

  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp) || timestamp < now) return undefined;
  const seconds = Math.ceil((timestamp - now) / 1_000);
  return Number.isSafeInteger(seconds) ? clampRetryAfter(seconds) : undefined;
}

export class WatchgooseApiClient {
  private readonly baseUrl: URL;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ApiClientOptions) {
    this.baseUrl = normalizeApiBaseUrl(options.apiUrl);
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async request(path: string, options: ApiRequestOptions = {}): Promise<unknown> {
    if (path.startsWith("/")) {
      throw new Error("API paths must be relative");
    }

    if (options.signal?.aborted) throw new ApiCancelledError();

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });

    const method = options.method ?? "GET";
    const headers = new Headers({
      Accept: "application/json",
      "X-Api-Key": this.options.apiKey,
    });
    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }

    try {
      const response = await this.fetchFn(new URL(path, this.baseUrl), {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
        redirect: "error",
      });
      const text = await readBoundedText(response);
      if (!response.ok) {
        throw new ApiResponseError(
          response.status,
          parseErrorDetail(text),
          parseRetryAfter(response.headers.get("retry-after"))
        );
      }
      if (!text) return null;

      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new InvalidApiResponseError();
      }
    } catch (error) {
      if (error instanceof ApiResponseError || error instanceof InvalidApiResponseError) {
        throw error;
      }
      if (timedOut) throw new ApiTimeoutError();
      if (options.signal?.aborted) throw new ApiCancelledError();
      throw new ApiNetworkError();
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
    }
  }
}
