import { McpServer } from "@modelcontextprotocol/server";
import {
  registerWatchgoosePrompts,
  registerWatchgooseTools,
  WATCHGOOSE_RELEASE_VERSION,
  WATCHGOOSE_STDIO_SERVER_INSTRUCTIONS,
} from "@watchgoose/mcp-core";
import type { StdioConfig } from "./config.js";

export const SERVER_VERSION = WATCHGOOSE_RELEASE_VERSION;

export function createServer(config: StdioConfig): McpServer {
  const server = new McpServer(
    { name: "watchgoose-mcp", version: SERVER_VERSION },
    {
      instructions: WATCHGOOSE_STDIO_SERVER_INSTRUCTIONS,
      capabilities: {
        tools: { listChanged: false },
        prompts: { listChanged: false },
      },
    }
  );
  registerWatchgooseTools(server, config);
  registerWatchgoosePrompts(server, {
    access: config.access,
    enableWrites: config.enableWrites,
    enableMcpEndpoints: false,
  });
  return server;
}

export function visibleToolCount(config: StdioConfig): number {
  if (config.access === "read-only") return 5;
  return config.enableWrites ? 13 : 7;
}
