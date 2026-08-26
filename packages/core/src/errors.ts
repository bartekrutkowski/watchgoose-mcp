export class ApiResponseError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string | undefined,
    readonly retryAfterSeconds?: number
  ) {
    super(`Watchgoose API returned HTTP ${status}`);
    this.name = "ApiResponseError";
  }
}

export class ApiTimeoutError extends Error {
  constructor() {
    super("Watchgoose API request timed out");
    this.name = "ApiTimeoutError";
  }
}

export class ApiCancelledError extends Error {
  constructor() {
    super("Watchgoose API request was cancelled");
    this.name = "ApiCancelledError";
  }
}

export class ApiNetworkError extends Error {
  constructor() {
    super("Watchgoose API request failed");
    this.name = "ApiNetworkError";
  }
}

export class InvalidApiResponseError extends Error {
  constructor() {
    super("Watchgoose API returned an unexpected response");
    this.name = "InvalidApiResponseError";
  }
}

export class ChannelResolutionError extends Error {
  constructor(readonly reason: "missing" | "duplicate" | "empty") {
    super("Unable to resolve integration name");
    this.name = "ChannelResolutionError";
  }
}

export function mapToolError(error: unknown): string {
  if (error instanceof ApiResponseError) {
    if (error.status === 400) {
      if (error.detail?.toLowerCase().includes("channel")) {
        return "Watchgoose rejected the integration assignment. Use exact, unique integration names from list_channels.";
      }
      return "Watchgoose rejected the request. Check the tool arguments against the documented schedule, grace, timeout, slug, timezone, and integration constraints.";
    }

    if (error.status === 401) {
      return "Watchgoose rejected the API credential or its declared access level. Reconnect or verify the credential configuration.";
    }

    if (error.status === 403) {
      if (error.detail?.toLowerCase().includes("check limit")) {
        return "This Watchgoose project has reached its check limit. Delete an unused check or raise the project limit before creating another one.";
      }
      return "Watchgoose denied access. Confirm that the API key belongs to this project and has read-write access for this operation.";
    }

    if (error.status === 404) {
      return "Check not found. Refresh list_checks and retry with a current unique_key from this project.";
    }

    if (error.status === 409) {
      return "Watchgoose could not complete the state change. A check must be paused before it can be resumed.";
    }

    if (error.status === 429) {
      if (error.retryAfterSeconds !== undefined) {
        return `Watchgoose is rate limiting requests. Back off and retry in ${error.retryAfterSeconds} seconds.`;
      }
      return "Watchgoose is rate limiting requests. Back off before retrying this tool.";
    }

    if (error.status >= 500) {
      return "Watchgoose is temporarily unavailable. Retry later.";
    }

    return "Watchgoose could not complete the request.";
  }

  if (error instanceof ApiTimeoutError) {
    return "The Watchgoose API did not respond within 30 seconds. Retry later.";
  }

  if (error instanceof ApiCancelledError) {
    return "The Watchgoose request was cancelled.";
  }

  if (error instanceof ApiNetworkError) {
    return "Could not reach the Watchgoose API. Check WATCHGOOSE_API_URL and network access, then retry.";
  }

  if (error instanceof InvalidApiResponseError) {
    return "Watchgoose returned an unexpected response. Retry later; if the problem persists, update the MCP server.";
  }

  if (error instanceof ChannelResolutionError) {
    if (error.reason === "duplicate") {
      return "An integration name matches more than once. Rename duplicate integrations in Watchgoose, then retry with an exact unique name.";
    }
    if (error.reason === "empty") {
      return "Integration names must not be empty. Name the integration in Watchgoose, then retry.";
    }
    return "Integration not found. Call list_channels and retry with an exact integration name.";
  }

  return "The Watchgoose MCP server could not complete the request.";
}
