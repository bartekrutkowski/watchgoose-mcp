import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { createServer, visibleToolCount } from "./server.js";

function main(): void {
  try {
    const config = loadConfig(process.env);
    const handle = serveStdio(() => createServer(config));

    const close = () => {
      void handle.close();
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);

    console.error(`Watchgoose MCP server ready with ${visibleToolCount(config)} tools`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Watchgoose MCP configuration";
    console.error(`Watchgoose MCP server failed to start: ${message}`);
    process.exitCode = 1;
  }
}

main();
