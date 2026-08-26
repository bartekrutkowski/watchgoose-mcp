import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { registerWatchgooseTools } from "@watchgoose/mcp-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.WATCHGOOSE_INTEGRATION === "1";
const API_URL = process.env.WATCHGOOSE_TEST_API_URL ?? "https://watchgoose.com/api/v3";
const RW_KEY = process.env.WATCHGOOSE_TEST_RW_API_KEY;
const RO_KEY = process.env.WATCHGOOSE_TEST_RO_API_KEY;
const RUN_RATE_LIMIT_TEST = process.env.WATCHGOOSE_TEST_429 === "1";

interface Harness {
  client: Client;
  server: McpServer;
}

interface CreatedCheck {
  uniqueKey: string;
  uuid: string;
  pingUrl: string;
}

const harnesses: Harness[] = [];
let created: CreatedCheck | undefined;

function apiBase(): URL {
  return new URL(API_URL.endsWith("/") ? API_URL : `${API_URL}/`);
}

async function rawApi(
  key: string,
  path: string,
  options: { method?: string; body?: Record<string, unknown> } = {}
): Promise<Response> {
  return fetch(new URL(path, apiBase()), {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      "X-Api-Key": key,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    redirect: "error",
  });
}

async function harness(
  key: string,
  access: "read-only" | "read-write",
  enableWrites: boolean,
  fetchFn?: typeof fetch
) {
  const server = new McpServer({ name: "watchgoose-integration", version: "0.1.0" });
  registerWatchgooseTools(server, {
    apiKey: key,
    apiUrl: API_URL,
    access,
    enableWrites,
    ...(fetchFn ? { fetch: fetchFn } : {}),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "integration-client", version: "0.1.0" });
  await client.connect(clientTransport);
  const result = { client, server };
  harnesses.push(result);
  return result;
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const block = result.content[0];
  return block?.type === "text" ? block.text : "";
}

function payload(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  expect(result.isError, text(result)).not.toBe(true);
  return JSON.parse(text(result)) as Record<string, unknown>;
}

const integration = ENABLED ? describe : describe.skip;

integration("Watchgoose production API", () => {
  beforeAll(() => {
    if (!RW_KEY || !RO_KEY) {
      throw new Error(
        "WATCHGOOSE_TEST_RW_API_KEY and WATCHGOOSE_TEST_RO_API_KEY are required for integration tests"
      );
    }
  });

  afterAll(async () => {
    await Promise.all(
      harnesses.splice(0).map(async ({ client, server }) => {
        await client.close();
        await server.close();
      })
    );
    if (created && RW_KEY) {
      await rawApi(RW_KEY, `checks/${created.uuid}`, { method: "DELETE" });
    }
  });

  it("exercises all tools and strips private ping data", async () => {
    const { client } = await harness(RW_KEY!, "read-write", true);
    const suffix = Date.now().toString(36);
    const create = await client.callTool({
      name: "create_check",
      arguments: {
        name: `MCP integration ${suffix}`,
        slug: `mcp-integration-${suffix}`,
        timeout: 300,
        grace: 60,
        manual_resume: true,
      },
    });
    const createdPayload = payload(create) as { check: { unique_key: string } };
    const uniqueKey = createdPayload.check.unique_key;

    const rawResponse = await rawApi(RW_KEY!, `checks/${uniqueKey}`);
    expect(rawResponse.status).toBe(200);
    const raw = (await rawResponse.json()) as { uuid: string; ping_url: string };
    created = { uniqueKey, uuid: raw.uuid, pingUrl: raw.ping_url };

    payload(
      await client.callTool({
        name: "update_check",
        arguments: { unique_key: uniqueKey, desc: "T-109 production integration check" },
      })
    );
    payload(await client.callTool({ name: "list_checks", arguments: { limit: 100 } }));
    payload(await client.callTool({ name: "get_check", arguments: { unique_key: uniqueKey } }));
    payload(await client.callTool({ name: "pause_check", arguments: { unique_key: uniqueKey } }));
    payload(await client.callTool({ name: "resume_check", arguments: { unique_key: uniqueKey } }));

    for (const suffixPath of ["/start", "", "/fail", ""]) {
      const ping = await fetch(`${raw.ping_url}${suffixPath}`, { redirect: "error" });
      expect(ping.ok).toBe(true);
    }

    const pings = await client.callTool({
      name: "list_pings",
      arguments: { unique_key: uniqueKey, limit: 100 },
    });
    const pingText = text(pings);
    expect(pings.isError, pingText).not.toBe(true);
    expect(pingText).not.toMatch(/remote_addr|body_url|"ua"|"rid"/);
    payload(
      await client.callTool({
        name: "list_flips",
        arguments: { unique_key: uniqueKey, seconds: 3600, limit: 200 },
      })
    );
    payload(await client.callTool({ name: "list_channels", arguments: { limit: 100 } }));

    const deleted = await client.callTool({
      name: "delete_check",
      arguments: { unique_key: uniqueKey },
    });
    payload(deleted);
    created = undefined;
  });

  it("verifies read-only key visibility and API permission", async () => {
    const { client } = await harness(RO_KEY!, "read-only", false);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "list_checks",
      "get_check",
      "list_flips",
    ]);
    const checks = payload(await client.callTool({ name: "list_checks", arguments: {} })) as {
      checks: Array<{ unique_key: string }>;
    };
    if (checks.checks[0]) {
      const uniqueKey = checks.checks[0].unique_key;
      payload(await client.callTool({ name: "get_check", arguments: { unique_key: uniqueKey } }));
      payload(await client.callTool({ name: "list_flips", arguments: { unique_key: uniqueKey } }));
    }

    const forbidden = await rawApi(RO_KEY!, "channels/");
    expect(forbidden.status).toBe(401);
  });

  it.skipIf(!RUN_RATE_LIMIT_TEST)("maps a live 429 response", async () => {
    let retryAfter: string | null = null;
    let retryAfterWasActionable = false;
    const observingFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (response.status === 429) {
        retryAfter = response.headers.get("retry-after");
        if (retryAfter) {
          const timestamp = Date.parse(retryAfter);
          retryAfterWasActionable =
            /^\d+$/.test(retryAfter) || (Number.isFinite(timestamp) && timestamp >= Date.now());
        }
      }
      return response;
    };
    const { client } = await harness(RW_KEY!, "read-write", false, observingFetch);
    let rateLimited = false;
    for (let attempt = 0; attempt < 250; attempt += 1) {
      const result = await client.callTool({ name: "list_checks", arguments: { limit: 1 } });
      if (result.isError && text(result).includes("Back off")) {
        rateLimited = true;
        if (retryAfter && /^\d+$/.test(retryAfter)) {
          const expected = Math.min(Math.max(Number(retryAfter), 1), 3_600);
          expect(text(result)).toContain(`retry in ${expected} seconds`);
        } else if (retryAfterWasActionable) {
          expect(text(result)).toMatch(/retry in \d+ seconds/);
        }
        break;
      }
    }
    expect(rateLimited).toBe(true);
  });
});
