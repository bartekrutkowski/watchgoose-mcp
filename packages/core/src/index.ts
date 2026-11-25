export { normalizeApiBaseUrl, WatchgooseApiClient, type ApiClientOptions } from "./api-client.js";
export {
  DEFAULT_API_URL,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_SERIALIZED_OUTPUT_CHARS,
  RESULT_CAPS,
  WATCHGOOSE_RELEASE_VERSION,
  type AccessLevel,
} from "./constants.js";
export { mapToolError } from "./errors.js";
export {
  WATCHGOOSE_SERVER_INSTRUCTIONS,
  WATCHGOOSE_STDIO_SERVER_INSTRUCTIONS,
} from "./instructions.js";
export {
  PROMPT_NAMES,
  registerWatchgoosePrompts,
  type WatchgoosePromptsOptions,
} from "./prompts.js";
export {
  deriveUniqueKey,
  sanitizeCheck,
  sanitizeChannel,
  sanitizeFlip,
  sanitizePing,
  slugifyCheckName,
} from "./sanitize.js";
export * from "./schemas.js";
export {
  buildSetupSnippet,
  SETUP_SNIPPET_PLATFORMS,
  type SetupSnippetInput,
  type SetupSnippetPlatform,
  type SetupSnippetResult,
} from "./snippets.js";
export { registerWatchgooseTools, TOOL_NAMES, type WatchgooseToolsOptions } from "./tools.js";
