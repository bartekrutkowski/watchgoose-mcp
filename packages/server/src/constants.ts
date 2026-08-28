export const ISSUER = "https://mcp.watchgoose.com";
export const RESOURCE = `${ISSUER}/mcp`;
export const API_URL = "https://watchgoose.com/api/v3";
export const CONNECT_URL = "https://watchgoose.com/mcp/connect/";
export const HANDOFF_URL = "http://web:8000/mcp/handoff/exchange/";
export const CALLBACK_URL = `${ISSUER}/oauth/callback`;
export const DOCS_URL = "https://watchgoose.com/docs/mcp/";

export const ACCESS_TOKEN_TTL = 60 * 60;
export const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;
export const AUTHORIZATION_CODE_TTL = 60;
export const TRANSIENT_TTL = 10 * 60;
export const CLIENT_REGISTRATION_TTL = 30 * 24 * 60 * 60;
export const MAX_DCR_CLIENTS = 10_000;
export const MAX_TRANSIENT_ROWS = 50_000;
export const MAX_REFRESH_ROWS = 100_000;
export const MCP_SCOPES = ["mcp:read", "mcp:write"] as const;
export const ALLOWED_SCOPES = [...MCP_SCOPES, "offline_access"] as const;

export const MAX_DCR_BYTES = 16_384;
export const MAX_MCP_REQUEST_BYTES = 1_048_576;
export const MAX_HANDOFF_RESPONSE_BYTES = 16_384;
