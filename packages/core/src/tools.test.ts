import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { registerWatchgooseTools, type WatchgooseToolsOptions } from "./tools.js";
import { deriveUniqueKey } from "./sanitize.js";

const API_KEY = `hcw_${"k".repeat(28)}`;
const UUID = "12345678-1234-5678-9234-567812345678";
const CHANNEL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
let UNIQUE_KEY: string;

interface RecordedRequest {
  method: string;
  pathname: string;
  search: string;
  body: unknown;
  headers: Headers;
  redirect: RequestRedirect | undefined;
}

interface Harness {
  client: Client;
  server: McpServer;
  requests: RecordedRequest[];
}

const activeHarnesses: Harness[] = [];

function rawCheck(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid: UUID,
    name: "Nightly backup",
    slug: "nightly-backup",
    tags: "prod backup",
    desc: "Runs every night",
    grace: 600,
    n_pings: 4,
    status: "up",
    started: false,
    last_ping: "2026-08-22T10:00:00Z",
    next_ping: "2026-08-23T10:00:00Z",
    manual_resume: true,
    methods: "POST",
    channels: CHANNEL_ID,
    schedule: "0 2 * * *",
    tz: "UTC",
    ping_url: "https://watchgoose.test/ping/private",
    update_url: `https://watchgoose.test/api/v3/checks/${UUID}`,
    pause_url: "https://watchgoose.test/private/pause",
    resume_url: "https://watchgoose.test/private/resume",
    badge_url: "https://watchgoose.test/private/badge",
    future_private: "future-sentinel",
    ...overrides,
  };
}

function createRouter(
  errorStatus?: number,
  rawChannels = CHANNEL_ID,
  channelRecords: Array<Record<string, unknown>> = [
    { id: CHANNEL_ID, name: "Ops email", kind: "email", secret: "sentinel" },
  ]
): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const check = (overrides: Record<string, unknown> = {}) =>
    rawCheck({ channels: rawChannels, ...overrides });
  const fetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({
      method,
      pathname: url.pathname,
      search: url.search,
      body,
      headers: new Headers(init?.headers),
      redirect: init?.redirect,
    });

    if (errorStatus !== undefined) {
      return Response.json({ error: "server detail must not escape" }, { status: errorStatus });
    }

    if (url.pathname.endsWith("/channels/")) {
      return Response.json({ channels: channelRecords });
    }
    if (url.pathname.endsWith("/pings/")) {
      return Response.json({
        pings: [
          {
            type: "success",
            date: "2026-08-22T10:00:00Z",
            n: 4,
            scheme: "https",
            method: "POST",
            duration: 3.25,
            remote_addr: "192.0.2.1",
            ua: "private-agent",
            rid: "private-run",
            body_url: "https://watchgoose.test/private/body",
          },
        ],
      });
    }
    if (url.pathname.endsWith("/flips/")) {
      return Response.json({ flips: [{ timestamp: "2026-08-22T09:00:00Z", up: 1 }] });
    }
    if (url.pathname.endsWith("/pause")) {
      return Response.json(check({ status: "paused" }));
    }
    if (url.pathname.endsWith("/resume")) {
      return Response.json(check({ status: "new" }));
    }
    if (url.pathname.endsWith("/checks/") && method === "GET") {
      return Response.json({ checks: [check()] });
    }
    if (url.pathname.endsWith("/checks/") && method === "POST") {
      return Response.json(check({ status: "new", n_pings: 0 }), { status: 201 });
    }
    if (url.pathname.includes("/checks/") && ["GET", "POST", "DELETE"].includes(method)) {
      return Response.json(check());
    }
    return Response.json({ error: "unexpected route" }, { status: 500 });
  });
  return { fetch, requests };
}

async function createHarness(
  policy: Pick<WatchgooseToolsOptions, "access" | "enableWrites">,
  errorStatus?: number,
  rawChannels = CHANNEL_ID,
  channelRecords?: Array<Record<string, unknown>>
): Promise<Harness> {
  const router = createRouter(errorStatus, rawChannels, channelRecords);
  const server = new McpServer({ name: "watchgoose-test", version: "0.1.0" });
  registerWatchgooseTools(server, {
    apiKey: API_KEY,
    apiUrl: "https://watchgoose.test/api/v3",
    fetch: router.fetch,
    ...policy,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await client.connect(clientTransport);
  const harness = { client, server, requests: router.requests };
  activeHarnesses.push(harness);
  return harness;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const block = result.content[0];
  return block?.type === "text" ? block.text : "";
}

function expectStructuredParity(result: Awaited<ReturnType<Client["callTool"]>>): void {
  const text = textOf(result);
  expect(result.structuredContent).toEqual(JSON.parse(text));
  expect(JSON.stringify(result.structuredContent)).toBe(text);
}

beforeAll(async () => {
  UNIQUE_KEY = await deriveUniqueKey(UUID);
});

afterEach(async () => {
  await Promise.all(
    activeHarnesses.splice(0).map(async ({ client, server }) => {
      await client.close();
      await server.close();
    })
  );
});

describe("tool visibility", () => {
  it.each([
    ["read-only", false, ["list_checks", "get_check", "list_flips"]],
    [
      "read-write",
      false,
      ["list_checks", "get_check", "list_pings", "list_flips", "list_channels"],
    ],
    [
      "read-write",
      true,
      [
        "list_checks",
        "get_check",
        "list_pings",
        "list_flips",
        "list_channels",
        "create_check",
        "update_check",
        "pause_check",
        "resume_check",
        "delete_check",
      ],
    ],
  ] as const)("exposes the exact %s tool set", async (access, enableWrites, expected) => {
    const { client } = await createHarness({ access, enableWrites });
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(expected);
    if (enableWrites) {
      expect(listed.tools.find((tool) => tool.name === "delete_check")?.annotations).toMatchObject({
        destructiveHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      });
    }
  });

  it("advertises a strict object output schema for every tool", async () => {
    const { client } = await createHarness({ access: "read-write", enableWrites: true });
    const listed = await client.listTools();
    const expectedRootProperties: Record<string, string> = {
      list_checks: "checks",
      get_check: "check",
      list_pings: "pings",
      list_flips: "flips",
      list_channels: "channels",
      create_check: "check",
      update_check: "check",
      pause_check: "check",
      resume_check: "check",
      delete_check: "deleted",
    };

    for (const tool of listed.tools) {
      const schema = tool.outputSchema as Record<string, unknown>;
      expect(schema.type, tool.name).toBe("object");
      expect(schema.additionalProperties, tool.name).toBe(false);
      expect(schema.properties, tool.name).toHaveProperty(expectedRootProperties[tool.name]!);
    }
  });

  it("describes the list_flips binary status projection", async () => {
    const { client } = await createHarness({ access: "read-only" });
    const listed = await client.listTools();
    const listFlips = listed.tools.find((tool) => tool.name === "list_flips");

    expect(listFlips?.description).toBe(
      "List retained status changes for a check, newest first, with optional time filters. In results, up: 1 means the check became up; up: 0 means any other status, including down, paused, and new after resume. A pause or resume that changes the check's status records a flip."
    );
  });

  it("matches the reviewed directory metadata", async () => {
    const { client } = await createHarness({ access: "read-write", enableWrites: true });
    const listed = await client.listTools();

    expect(
      listed.tools.map(({ name, title, description, annotations }) => ({
        name,
        title,
        description,
        annotations,
      }))
    ).toEqual([
      {
        name: "list_checks",
        title: "List Watchgoose checks",
        description:
          "List checks in this Watchgoose project, optionally filtered by slug or tags. A successful ping arms a new check; Watchgoose then expects the next success within its timeout or schedule plus grace period.",
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "get_check",
        title: "Get a Watchgoose check",
        description:
          "Get one check by its stable unique_key, including its current state and schedule. Cron and OnCalendar checks use schedule plus grace; simple checks use timeout plus grace.",
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "list_pings",
        title: "List a check's pings",
        description:
          "List recent signals for a check, newest first. Success arms or advances monitoring, /fail records failure, and /start begins runtime measurement. Source addresses, user agents, run IDs, body URLs, and ping bodies are never returned.",
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "list_flips",
        title: "List a check's status changes",
        description:
          "List retained status changes for a check, newest first, with optional time filters. In results, up: 1 means the check became up; up: 0 means any other status, including down, paused, and new after resume. A pause or resume that changes the check's status records a flip.",
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "list_channels",
        title: "List Watchgoose integrations",
        description:
          "List integration names and kinds available for check notifications. Only exact, unique integration names can be assigned to checks.",
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "create_check",
        title: "Create a Watchgoose check",
        description:
          "Create a simple timeout check or a cron/OnCalendar schedule check. All fields are optional; schedule takes precedence over timeout. The new check remains unarmed until its first successful ping.",
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      {
        name: "update_check",
        title: "Update a Watchgoose check",
        description:
          "Update selected fields on an existing check. Omitted fields remain unchanged; schedule takes precedence over timeout, and integration names must match exactly.",
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "pause_check",
        title: "Pause a Watchgoose check",
        description:
          "Pause monitoring without deleting the check. Unless manual_resume is enabled, a later ping can automatically resume a paused check.",
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "resume_check",
        title: "Resume a Watchgoose check",
        description:
          "Resume a paused check and return it to the new state. The next successful ping arms its monitoring schedule.",
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "delete_check",
        title: "Delete a Watchgoose check",
        description:
          "Permanently delete a check and its retained monitoring history. This cannot be undone.",
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
    ]);

    for (const tool of listed.tools) {
      const crossReferences = listed.tools
        .filter((candidate) => candidate.name !== tool.name)
        .filter((candidate) => tool.description?.includes(candidate.name))
        .map((candidate) => candidate.name);
      expect(crossReferences, tool.name).toEqual([]);
    }
  });
});

describe("tool calls", () => {
  it("executes and sanitizes every tool through MCP", async () => {
    const { client, requests } = await createHarness({ access: "read-write", enableWrites: true });
    await client.listTools();
    const calls = [
      ["list_checks", { slug: "nightly-backup", tags: ["prod"], limit: 10 }],
      ["get_check", { unique_key: UNIQUE_KEY }],
      ["list_pings", { unique_key: UNIQUE_KEY, limit: 10 }],
      ["list_flips", { unique_key: UNIQUE_KEY, seconds: 3600, limit: 10 }],
      ["list_channels", { limit: 10 }],
      [
        "create_check",
        { name: "Nightly backup", tags: ["prod", "backup"], channels: ["Ops email"] },
      ],
      ["update_check", { unique_key: UNIQUE_KEY, name: "Updated", channels: ["Ops email"] }],
      ["pause_check", { unique_key: UNIQUE_KEY }],
      ["resume_check", { unique_key: UNIQUE_KEY }],
      ["delete_check", { unique_key: UNIQUE_KEY }],
    ] as const;

    for (const [name, args] of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, `${name}: ${textOf(result)}`).not.toBe(true);
      const text = textOf(result);
      expectStructuredParity(result);
      expect(text).not.toMatch(
        /private-agent|private-run|private\/body|future-sentinel|ping\/private|aaaaaaaa-bbbb/
      );
      expect(text.length).toBeLessThanOrEqual(24_000);
    }

    expect(requests).not.toContainEqual(
      expect.objectContaining({ pathname: expect.stringContaining("/body") })
    );
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "GET",
        pathname: "/api/v3/checks/",
        search: "?slug=nightly-backup&tag=prod",
      })
    );
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/api/v3/checks/",
        body: expect.objectContaining({
          tags: "prod backup",
          channels: CHANNEL_ID,
        }),
      })
    );
    expect(requests.every((request) => request.headers.get("x-api-key") === API_KEY)).toBe(true);
    expect(requests.every((request) => request.redirect === "error")).toBe(true);
  });

  it("returns a friendly error for every tool", async () => {
    const { client } = await createHarness({ access: "read-write", enableWrites: true }, 429);
    await client.listTools();
    const calls: Record<string, Record<string, unknown>> = {
      list_checks: {},
      get_check: { unique_key: UNIQUE_KEY },
      list_pings: { unique_key: UNIQUE_KEY },
      list_flips: { unique_key: UNIQUE_KEY },
      list_channels: {},
      create_check: { name: "Test" },
      update_check: { unique_key: UNIQUE_KEY, name: "Test" },
      pause_check: { unique_key: UNIQUE_KEY },
      resume_check: { unique_key: UNIQUE_KEY },
      delete_check: { unique_key: UNIQUE_KEY },
    };

    for (const [name, args] of Object.entries(calls)) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBe(true);
      expect(textOf(result)).toContain("Back off");
      expect(textOf(result)).not.toContain("server detail");
      expect(result.structuredContent).toBeUndefined();
    }
  });

  it("does not fetch channels for a channel-free state mutation", async () => {
    const { client, requests } = await createHarness(
      { access: "read-write", enableWrites: true },
      undefined,
      ""
    );
    const result = await client.callTool({
      name: "pause_check",
      arguments: { unique_key: UNIQUE_KEY },
    });
    expect(result.isError, textOf(result)).not.toBe(true);
    expect(requests.map((request) => request.pathname)).toEqual([
      `/api/v3/checks/${UNIQUE_KEY}`,
      `/api/v3/checks/${UUID}/pause`,
    ]);
  });

  it.each([
    [
      "missing",
      [],
      "Integration not found. Call list_channels and retry with an exact integration name.",
    ],
    [
      "duplicate",
      [
        { id: CHANNEL_ID, name: "Ops email", kind: "email" },
        { id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", name: "Ops email", kind: "webhook" },
      ],
      "An integration name matches more than once. Rename duplicate integrations in Watchgoose, then retry with an exact unique name.",
    ],
  ] as const)(
    "rejects a %s integration name before mutation",
    async (_case, channels, expected) => {
      const { client, requests } = await createHarness(
        { access: "read-write", enableWrites: true },
        undefined,
        CHANNEL_ID,
        [...channels]
      );
      await client.listTools();
      const result = await client.callTool({
        name: "create_check",
        arguments: { name: "Test", channels: ["Ops email"] },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(expected);
      expect(result.structuredContent).toBeUndefined();
      expect(requests.some((request) => request.method === "POST")).toBe(false);
    }
  );

  it("rejects malformed identifiers before making an API request", async () => {
    const { client, requests } = await createHarness({ access: "read-only", enableWrites: false });
    const result = await client.callTool({
      name: "get_check",
      arguments: { unique_key: "NOT-A-KEY" },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(requests).toHaveLength(0);
  });
});
