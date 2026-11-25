import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  WATCHGOOSE_SERVER_INSTRUCTIONS,
  WATCHGOOSE_STDIO_SERVER_INSTRUCTIONS,
} from "./instructions.js";
import { PROMPT_NAMES, registerWatchgoosePrompts } from "./prompts.js";
import { deriveUniqueKey } from "./sanitize.js";
import { registerWatchgooseTools, type WatchgooseToolsOptions } from "./tools.js";

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
  ],
  checksList?: Array<Record<string, unknown>>
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

    if (url.pathname.endsWith("/mcp/channels/test/") && method === "POST") {
      const payload = body as { name?: string };
      return Response.json({
        name: payload.name ?? "Ops email",
        kind: "email",
        sent: true,
        error: null,
      });
    }
    if (url.pathname.includes("/mcp/checks/") && url.pathname.endsWith("/report/")) {
      const payload = body as { status?: string };
      return Response.json({
        unique_key: UNIQUE_KEY,
        name: "Nightly backup",
        slug: "nightly-backup",
        action: payload.status ?? "success",
        status: payload.status === "fail" ? "down" : "up",
        started: payload.status === "start",
        n_pings: 5,
        last_ping: "2026-08-22T10:05:00Z",
        next_ping: "2026-08-23T10:05:00Z",
        last_duration: 12,
      });
    }
    if (url.pathname.includes("/mcp/checks/") && url.pathname.endsWith("/last-failure/")) {
      return Response.json({
        unique_key: UNIQUE_KEY,
        name: "Nightly backup",
        status: "down",
        has_failure: true,
        last_down_at: "2026-08-22T10:01:00Z",
        reason: "fail",
        reason_long: "received a failure signal",
        down_duration_seconds: 120,
        ping: {
          type: "fail",
          date: "2026-08-22T10:01:00Z",
          n: 4,
          exit_status: 1,
          scheme: "https",
          method: "POST",
          has_body: true,
          body_size_bytes: 128,
        },
      });
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
      return Response.json({ checks: checksList ?? [check()] });
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
  policy: Pick<WatchgooseToolsOptions, "access" | "enableWrites" | "enableMcpEndpoints">,
  errorStatus?: number,
  rawChannels = CHANNEL_ID,
  channelRecords?: Array<Record<string, unknown>>,
  checksList?: Array<Record<string, unknown>>
): Promise<Harness> {
  const router = createRouter(errorStatus, rawChannels, channelRecords, checksList);
  const server = new McpServer(
    { name: "watchgoose-test", version: "0.1.0" },
    {
      instructions: WATCHGOOSE_SERVER_INSTRUCTIONS,
      capabilities: {
        tools: { listChanged: false },
        prompts: { listChanged: false },
      },
    }
  );
  registerWatchgooseTools(server, {
    apiKey: API_KEY,
    apiUrl: "https://watchgoose.test/api/v3",
    enableMcpEndpoints: true,
    fetch: router.fetch,
    ...policy,
  });
  registerWatchgoosePrompts(server, { enableMcpEndpoints: true, ...policy });
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

describe("instructions and prompts", () => {
  it("keeps the leading server instruction paragraph within 512 characters", () => {
    const firstParagraph = WATCHGOOSE_SERVER_INSTRUCTIONS.split("\n\n")[0]!;
    expect(firstParagraph.length).toBeLessThanOrEqual(512);
    expect(firstParagraph).toContain("My First Check");
    expect(firstParagraph).toContain("dashboard_url");
    expect(firstParagraph).toContain("report_run");

    const stdioFirstParagraph = WATCHGOOSE_STDIO_SERVER_INSTRUCTIONS.split("\n\n")[0]!;
    expect(stdioFirstParagraph.length).toBeLessThanOrEqual(512);
    expect(WATCHGOOSE_STDIO_SERVER_INSTRUCTIONS).not.toContain("report_run");
  });

  it("exposes all four built-in prompts and returns actionable messages", async () => {
    const { client } = await createHarness({ access: "read-write", enableWrites: true });
    const listed = await client.listPrompts();
    expect(listed.prompts.map((prompt) => prompt.name)).toEqual([...PROMPT_NAMES]);

    const setup = await client.getPrompt({
      name: "setup_first_monitor",
      arguments: { job_description: "Nightly Postgres backup", platform: "cron" },
    });
    const firstMessage = setup.messages[0]?.content;
    expect(firstMessage?.type === "text" ? firstMessage.text : "").toContain("create_check");

    const agentPrompt = await client.getPrompt({
      name: "monitor_scheduled_agent",
      arguments: { routine_name: "PR triage", schedule: "0 9 * * 1-5" },
    });
    const agentText = agentPrompt.messages[0]?.content;
    expect(agentText?.type === "text" ? agentText.text : "").toContain("report_run");
  });
});

describe("tool visibility", () => {
  it.each([
    [
      "read-only",
      false,
      ["list_checks", "get_check", "list_flips", "get_health_summary", "get_setup_snippet"],
    ],
    [
      "read-write",
      false,
      [
        "list_checks",
        "get_check",
        "list_flips",
        "get_health_summary",
        "get_setup_snippet",
        "list_pings",
        "list_channels",
        "get_last_failure",
      ],
    ],
    [
      "read-write",
      true,
      [
        "list_checks",
        "get_check",
        "list_flips",
        "get_health_summary",
        "get_setup_snippet",
        "list_pings",
        "list_channels",
        "get_last_failure",
        "create_check",
        "upsert_check",
        "update_check",
        "pause_check",
        "resume_check",
        "delete_check",
        "report_run",
        "test_channel",
      ],
    ],
  ] as const)("exposes the exact %s tool set", async (access, enableWrites, expected) => {
    const { client } = await createHarness({ access, enableWrites });
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(expected);
    if (enableWrites) {
      expect(listed.tools.find((tool) => tool.name === "create_check")?.annotations).toMatchObject({
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      });
      expect(listed.tools.find((tool) => tool.name === "upsert_check")?.annotations).toMatchObject({
        destructiveHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      });
      expect(listed.tools.find((tool) => tool.name === "delete_check")?.annotations).toMatchObject({
        destructiveHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      });
      expect(listed.tools.find((tool) => tool.name === "report_run")?.annotations).toMatchObject({
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      });
      expect(listed.tools.find((tool) => tool.name === "test_channel")?.annotations).toMatchObject({
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      });
    }
  });

  it("hides hosted-MCP-only tools when enableMcpEndpoints is false (stdio mode)", async () => {
    const { client } = await createHarness({
      access: "read-write",
      enableWrites: true,
      enableMcpEndpoints: false,
    });
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "list_checks",
      "get_check",
      "list_flips",
      "get_health_summary",
      "get_setup_snippet",
      "list_pings",
      "list_channels",
      "create_check",
      "upsert_check",
      "update_check",
      "pause_check",
      "resume_check",
      "delete_check",
    ]);
    const stdioCreate = listed.tools.find((tool) => tool.name === "create_check");
    expect(stdioCreate?.description).not.toContain("report scheduled AI runs");

    const { client: hostedClient } = await createHarness({
      access: "read-write",
      enableWrites: true,
      enableMcpEndpoints: true,
    });
    const hostedListed = await hostedClient.listTools();
    const hostedCreate = hostedListed.tools.find((tool) => tool.name === "create_check");
    expect(hostedCreate?.description).toContain("report scheduled AI runs");
  });

  it("advertises a strict object output schema for every tool", async () => {
    const { client } = await createHarness({ access: "read-write", enableWrites: true });
    const listed = await client.listTools();
    const expectedRootProperties: Record<string, string> = {
      list_checks: "checks",
      get_check: "check",
      list_flips: "flips",
      get_health_summary: "summary",
      get_setup_snippet: "setup",
      list_pings: "pings",
      list_channels: "channels",
      get_last_failure: "failure",
      create_check: "check",
      upsert_check: "check",
      update_check: "check",
      pause_check: "check",
      resume_check: "check",
      delete_check: "deleted",
      report_run: "report",
      test_channel: "result",
    };

    for (const tool of listed.tools) {
      const schema = tool.outputSchema as Record<string, unknown>;
      expect(schema.type, tool.name).toBe("object");
      expect(schema.additionalProperties, tool.name).toBe(false);
      expect(schema.properties, tool.name).toHaveProperty(expectedRootProperties[tool.name]!);
    }
  });

  it("describes every input parameter and keeps tool descriptions self-contained", async () => {
    const { client } = await createHarness({ access: "read-write", enableWrites: true });
    const listed = await client.listTools();
    const writable = [
      "name",
      "slug",
      "tags",
      "desc",
      "timeout",
      "grace",
      "schedule",
      "tz",
      "manual_resume",
      "methods",
      "channels",
      "start_kw",
      "success_kw",
      "failure_kw",
      "filter_subject",
      "filter_body",
      "filter_http_body",
      "filter_default_fail",
    ];
    const expectedProperties: Record<string, string[]> = {
      list_checks: ["slug", "tags", "limit"],
      get_check: ["unique_key"],
      list_flips: ["unique_key", "seconds", "start", "end", "limit"],
      get_health_summary: ["tags"],
      get_setup_snippet: ["unique_key", "platform", "include_start"],
      list_pings: ["unique_key", "limit"],
      list_channels: ["limit"],
      get_last_failure: ["unique_key"],
      create_check: [...writable],
      upsert_check: [...writable, "unique"],
      update_check: ["unique_key", ...writable],
      pause_check: ["unique_key"],
      resume_check: ["unique_key"],
      delete_check: ["unique_key"],
      report_run: ["unique_key", "status", "exit_status", "summary", "rid"],
      test_channel: ["name"],
    };
    const expectedRequired: Record<string, string[]> = {
      list_checks: [],
      get_check: ["unique_key"],
      list_flips: ["unique_key"],
      get_health_summary: [],
      get_setup_snippet: ["unique_key", "platform"],
      list_pings: ["unique_key"],
      list_channels: [],
      get_last_failure: ["unique_key"],
      create_check: [],
      upsert_check: ["unique"],
      update_check: ["unique_key"],
      pause_check: ["unique_key"],
      resume_check: ["unique_key"],
      delete_check: ["unique_key"],
      report_run: ["unique_key", "status"],
      test_channel: ["name"],
    };

    for (const tool of listed.tools) {
      const schema = tool.inputSchema as {
        properties?: Record<string, { description?: string }>;
        required?: string[];
      };
      const properties = schema.properties ?? {};
      expect(schema).toMatchObject({ type: "object", additionalProperties: false });
      expect(Object.keys(properties).sort(), tool.name).toEqual(
        [...expectedProperties[tool.name]!].sort()
      );
      for (const [name, property] of Object.entries(properties)) {
        expect(property.description?.trim().length, `${tool.name}.${name}`).toBeGreaterThan(0);
      }
      expect((schema.required ?? []).sort(), tool.name).toEqual(
        [...expectedRequired[tool.name]!].sort()
      );
      const crossReferences = listed.tools
        .filter((candidate) => candidate.name !== tool.name)
        .filter((candidate) => tool.description?.includes(candidate.name))
        .map((candidate) => candidate.name);
      expect(crossReferences, tool.name).toEqual([]);
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
});

describe("tool calls", () => {
  it("defaults create_check channels to '*' and auto-generates slug from name", async () => {
    const { client, requests } = await createHarness({ access: "read-write", enableWrites: true });
    const result = await client.callTool({
      name: "create_check",
      arguments: {
        name: "Nightly DB Backup",
        timeout: 86_400,
      },
    });

    expect(result.isError, textOf(result)).not.toBe(true);
    expectStructuredParity(result);
    const parsed = result.structuredContent as { check: { dashboard_url: string } };
    expect(parsed.check.dashboard_url).toBe(`https://watchgoose.test/cloaked/${UNIQUE_KEY}/`);
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/api/v3/checks/",
        body: {
          name: "Nightly DB Backup",
          slug: "nightly-db-backup",
          channels: "*",
          timeout: 86_400,
        },
      })
    );
  });

  it("preserves upsert_check matching and converts empty integration assignments to clearing value", async () => {
    const { client, requests } = await createHarness({ access: "read-write", enableWrites: true });
    const result = await client.callTool({
      name: "upsert_check",
      arguments: {
        name: "Nightly backup",
        unique: ["name"],
        channels: [],
        timeout: 86_400,
      },
    });

    expect(result.isError, textOf(result)).not.toBe(true);
    expectStructuredParity(result);
    expect(requests.map(({ method, pathname, body }) => ({ method, pathname, body }))).toEqual([
      {
        method: "POST",
        pathname: "/api/v3/checks/",
        body: {
          name: "Nightly backup",
          unique: ["name"],
          channels: "",
          timeout: 86_400,
        },
      },
    ]);
  });

  it("summarizes project health and flags fresh starter projects", async () => {
    const { client } = await createHarness(
      { access: "read-write", enableWrites: true },
      undefined,
      "",
      [{ id: CHANNEL_ID, name: "Ops email", kind: "email" }],
      [
        rawCheck({
          name: "My First Check",
          slug: "my-first-check",
          status: "new",
          n_pings: 0,
          channels: "",
        }),
      ]
    );
    const result = await client.callTool({ name: "get_health_summary", arguments: {} });
    expect(result.isError, textOf(result)).not.toBe(true);
    expectStructuredParity(result);
    const summary = (result.structuredContent as { summary: Record<string, unknown> }).summary;
    expect(summary.total).toBe(1);
    expect(summary.is_fresh_starter_project).toBe(true);
    expect(summary.counts).toEqual({ up: 0, down: 0, grace: 0, new: 1, paused: 0 });
    expect(summary.channels_available).toBe(1);
    expect(summary.checks_without_channels).toHaveLength(1);
  });

  it("generates platform setup snippets and AI routine report_run instructions", async () => {
    const { client } = await createHarness({ access: "read-only" });

    const cron = await client.callTool({
      name: "get_setup_snippet",
      arguments: { unique_key: UNIQUE_KEY, platform: "cron" },
    });
    expect(cron.isError, textOf(cron)).not.toBe(true);
    expectStructuredParity(cron);
    const cronSetup = (cron.structuredContent as { setup: Record<string, unknown> }).setup;
    expect(cronSetup.uses_mcp_report_run).toBe(false);
    expect(cronSetup.dashboard_url).toBe(`https://watchgoose.test/cloaked/${UNIQUE_KEY}/`);
    expect(cronSetup.snippet).toContain("WATCHGOOSE_PING_URL_NIGHTLY_BACKUP");
    expect(cronSetup.snippet).not.toContain("ping/private");

    const routine = await client.callTool({
      name: "get_setup_snippet",
      arguments: { unique_key: UNIQUE_KEY, platform: "codex-automation" },
    });
    expect(routine.isError, textOf(routine)).not.toBe(true);
    const routineSetup = (routine.structuredContent as { setup: Record<string, unknown> }).setup;
    expect(routineSetup.uses_mcp_report_run).toBe(true);
    expect(routineSetup.snippet).toContain("report_run");
    expect(routineSetup.snippet).toContain(UNIQUE_KEY);
    expect(routineSetup.instructions).toContain("Codex Automation");
    expect(routineSetup.instructions).not.toContain("codex-automation");
  });

  it("executes and sanitizes every tool through MCP", async () => {
    const { client, requests } = await createHarness({ access: "read-write", enableWrites: true });
    await client.listTools();
    const calls = [
      ["list_checks", { slug: "nightly-backup", tags: ["prod"], limit: 10 }],
      ["get_check", { unique_key: UNIQUE_KEY }],
      ["list_flips", { unique_key: UNIQUE_KEY, seconds: 3600, limit: 10 }],
      ["get_health_summary", { tags: ["prod"] }],
      ["get_setup_snippet", { unique_key: UNIQUE_KEY, platform: "docker" }],
      ["list_pings", { unique_key: UNIQUE_KEY, limit: 10 }],
      ["list_channels", { limit: 10 }],
      ["get_last_failure", { unique_key: UNIQUE_KEY }],
      [
        "create_check",
        { name: "Nightly backup", tags: ["prod", "backup"], channels: ["Ops email"] },
      ],
      ["upsert_check", { name: "Nightly backup", unique: ["name"], channels: ["Ops email"] }],
      ["update_check", { unique_key: UNIQUE_KEY, name: "Updated", channels: ["Ops email"] }],
      ["pause_check", { unique_key: UNIQUE_KEY }],
      ["resume_check", { unique_key: UNIQUE_KEY }],
      ["delete_check", { unique_key: UNIQUE_KEY }],
      ["report_run", { unique_key: UNIQUE_KEY, status: "success", summary: "All good" }],
      ["test_channel", { name: "Ops email" }],
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
        method: "POST",
        pathname: `/api/v3/mcp/checks/${UNIQUE_KEY}/report/`,
        body: { status: "success", summary: "All good" },
      })
    );
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "GET",
        pathname: `/api/v3/mcp/checks/${UNIQUE_KEY}/last-failure/`,
      })
    );
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/api/v3/mcp/channels/test/",
        body: { name: "Ops email" },
      })
    );
    expect(requests.every((request) => request.headers.get("x-api-key") === API_KEY)).toBe(true);
    expect(requests.every((request) => request.redirect === "error")).toBe(true);
  });

  it("returns structured failure metadata without ping body contents", async () => {
    const { client } = await createHarness({ access: "read-write", enableWrites: false });
    const result = await client.callTool({
      name: "get_last_failure",
      arguments: { unique_key: UNIQUE_KEY },
    });
    expect(result.isError, textOf(result)).not.toBe(true);
    const failure = (
      result.structuredContent as {
        failure: { dashboard_url: string; ping: { has_body: boolean; body_size_bytes: number } };
      }
    ).failure;
    expect(failure.dashboard_url).toBe(`https://watchgoose.test/cloaked/${UNIQUE_KEY}/`);
    expect(failure.ping.has_body).toBe(true);
    expect(failure.ping.body_size_bytes).toBe(128);
    expect(textOf(result)).not.toContain("body_excerpt");
  });

  it("returns a friendly error for every tool", async () => {
    const { client } = await createHarness({ access: "read-write", enableWrites: true }, 429);
    await client.listTools();
    const calls: Record<string, Record<string, unknown>> = {
      list_checks: {},
      get_check: { unique_key: UNIQUE_KEY },
      list_flips: { unique_key: UNIQUE_KEY },
      get_health_summary: {},
      get_setup_snippet: { unique_key: UNIQUE_KEY, platform: "cron" },
      list_pings: { unique_key: UNIQUE_KEY },
      list_channels: {},
      get_last_failure: { unique_key: UNIQUE_KEY },
      create_check: { name: "Test" },
      upsert_check: { name: "Test", unique: ["name"] },
      update_check: { unique_key: UNIQUE_KEY, name: "Test" },
      pause_check: { unique_key: UNIQUE_KEY },
      resume_check: { unique_key: UNIQUE_KEY },
      delete_check: { unique_key: UNIQUE_KEY },
      report_run: { unique_key: UNIQUE_KEY, status: "success" },
      test_channel: { name: "Ops email" },
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
