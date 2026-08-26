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

  it("advertises the npm package version in the MCP handshake", () => {
    const packageJson = JSON.parse(readFileSync("packages/stdio/package.json", "utf8")) as {
      version: string;
    };
    expect(SERVER_VERSION).toBe(packageJson.version);
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
    } finally {
      await client.close();
    }

    expect(stderr).toContain("ready with 3 tools");
    expect(stderr).not.toContain(API_KEY);
  });
});
