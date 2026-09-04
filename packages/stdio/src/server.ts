import { McpServer } from "@modelcontextprotocol/server";
import { registerWatchgooseTools } from "@watchgoose/mcp-core";
import type { StdioConfig } from "./config.js";

export const SERVER_VERSION = "0.1.2";

export function createServer(config: StdioConfig): McpServer {
  const server = new McpServer({ name: "watchgoose-mcp", version: SERVER_VERSION });
  registerWatchgooseTools(server, config);
  return server;
}

export function visibleToolCount(config: StdioConfig): number {
  if (config.access === "read-only") return 3;
  return config.enableWrites ? 10 : 5;
}
