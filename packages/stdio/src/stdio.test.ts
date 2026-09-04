import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";
import { SERVER_VERSION } from "./server.js";

const API_KEY = `hcr_${"r".repeat(28)}`;

describe("stdio executable", () => {
  it("publishes the complete repository README without drift", () => {
    expect(readFileSync("packages/stdio/README.md", "utf8")).toBe(
      readFileSync("README.md", "utf8")
    );
  });

  it("publishes the exact four-link availability block", () => {
    const readme = readFileSync("README.md", "utf8");
    const block = readme.split("### Available in\n\n", 2)[1]?.split("\n\nIn Claude", 1)[0];

    expect(block).toBe(
      "Watchgoose is [available in the Claude connector directory](https://claude.ai/directory/watchgoose).\n\n" +
        "Watchgoose is\n[listed in ChatGPT plugins for GPT and Codex](https://chatgpt.com/plugins/plugin_asdk_app_6a95a3bd1df8819197ab3ccbf9269e8d).\n\n" +
        "Watchgoose is\n[listed in the official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.bartekrutkowski/watchgoose-mcp).\n\n" +
        "The [`watchgoose-mcp` package is available on npm](https://www.npmjs.com/package/watchgoose-mcp)."
    );
  });

  it("keeps npm, MCP handshake, and Registry metadata aligned", () => {
    const packageJson = JSON.parse(readFileSync("packages/stdio/package.json", "utf8")) as {
      name: string;
      version: string;
      mcpName: string;
    };
    const registry = JSON.parse(readFileSync("server.json", "utf8")) as {
      name: string;
      version: string;
      packages: unknown[];
    };
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages: Record<string, { version?: string }>;
    };

    expect(packageJson.version).toBe("0.1.2");
    expect(SERVER_VERSION).toBe(packageJson.version);
    expect(lock.packages["packages/stdio"]?.version).toBe(packageJson.version);
    expect(packageJson.mcpName).toBe("io.github.bartekrutkowski/watchgoose-mcp");
    expect(registry).toMatchObject({
      name: packageJson.mcpName,
      version: packageJson.version,
      packages: [
        {
          registryType: "npm",
          identifier: packageJson.name,
          version: packageJson.version,
          transport: { type: "stdio" },
          environmentVariables: [
            {
              name: "WATCHGOOSE_API_KEY",
              description: "Project-scoped Watchgoose API key: hcr_ read-only or hcw_ read-write.",
              isRequired: true,
              isSecret: true,
            },
          ],
        },
      ],
    });
  });

  it("negotiates over clean stdout and exposes the classified tool set", async () => {
    let stderr = "";
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["packages/stdio/dist/cli.js"],
      cwd: process.cwd(),
      env: { ...getDefaultEnvironment(), WATCHGOOSE_API_KEY: API_KEY },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const client = new Client({ name: "stdio-test", version: "0.1.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        "list_checks",
        "get_check",
        "list_flips",
      ]);
      for (const tool of listed.tools) {
        expect(tool.outputSchema).toMatchObject({
          type: "object",
          additionalProperties: false,
        });
      }
    } finally {
      await client.close();
    }

    expect(stderr).toContain("ready with 3 tools");
    expect(stderr).not.toContain(API_KEY);
  });
});
