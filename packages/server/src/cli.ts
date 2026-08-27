#!/usr/bin/env node
import { loadProductionConfig } from "./config.js";
import { SqliteState } from "./database.js";
import { createWatchgooseService } from "./service.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "serve";
  const config = loadProductionConfig();
  if (command === "prune") {
    const state = new SqliteState(config.databasePath, config.encryptionKey, config.now);
    try {
      state.prune(Number(option("--limit") ?? "10000"));
    } finally {
      state.close();
    }
    return;
  }
  if (command === "backup") {
    const destination = option("--output");
    if (!destination) throw new Error("backup output is required");
    const state = new SqliteState(config.databasePath, config.encryptionKey, config.now);
    try {
      await state.backup(destination);
    } finally {
      state.close();
    }
    return;
  }
  if (command !== "serve") throw new Error("unknown command");
  const service = createWatchgooseService(config);
  await service.start();
  console.log("watchgoose-mcp server listening");
  const shutdown = () => void service.close().then(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(() => {
  console.error("watchgoose-mcp: fatal startup error");
  process.exitCode = 1;
});
