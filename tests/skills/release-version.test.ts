import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WATCHGOOSE_RELEASE_VERSION } from "../../packages/core/src/constants.js";

function version(path: string, select: (json: Record<string, unknown>) => unknown): unknown {
  return select(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>);
}

describe("single Watchgoose release version", () => {
  it("is shared by every user-visible distribution", () => {
    const registry = JSON.parse(readFileSync("server.json", "utf8")) as {
      version: string;
      packages: Array<{ version: string }>;
    };
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages: Record<string, { version?: string }>;
    };
    const versions = {
      "root package.json": version("package.json", (json) => json.version),
      "npm package": version("packages/stdio/package.json", (json) => json.version),
      "package-lock root": lock.packages[""]?.version,
      "package-lock npm package": lock.packages["packages/stdio"]?.version,
      "server.json": registry.version,
      "server.json npm package": registry.packages[0]?.version,
      "Claude plugin": version(
        "plugins/watchgoose-monitoring/.claude-plugin/plugin.json",
        (json) => json.version
      ),
      "portable plugin": version(
        "plugins/watchgoose-monitoring/plugin.json",
        (json) => json.version
      ),
      "Cursor plugin": version(
        "plugins/watchgoose-monitoring/.cursor-plugin/plugin.json",
        (json) => json.version
      ),
      "Grok plugin": version(
        "plugins/watchgoose-monitoring/.grok-plugin/plugin.json",
        (json) => json.version
      ),
      "OpenAI plugin": version("distribution/openai/plugin.json", (json) => json.version),
    };
    for (const [source, value] of Object.entries(versions)) {
      expect(value, source).toBe(WATCHGOOSE_RELEASE_VERSION);
    }
  });

  it("is a plain semantic version", () => {
    expect(WATCHGOOSE_RELEASE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
