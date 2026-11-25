import type { McpServer } from "@modelcontextprotocol/server";
import { WatchgooseApiClient } from "./api-client.js";
import { DEFAULT_TIMEOUT_MS, RESULT_CAPS, type AccessLevel } from "./constants.js";
import { ChannelResolutionError, InvalidApiResponseError, mapToolError } from "./errors.js";
import { errorToolResult, listToolResult, objectToolResult, type ToolResult } from "./output.js";
import {
  apiRecordSchema,
  channelsResponseSchema,
  checkStateInputSchema,
  checksResponseSchema,
  createCheckInputSchema,
  deleteCheckOutputSchema,
  flipsResponseSchema,
  getCheckInputSchema,
  getCheckOutputSchema,
  getHealthSummaryInputSchema,
  getHealthSummaryOutputSchema,
  getLastFailureInputSchema,
  getLastFailureOutputSchema,
  getSetupSnippetInputSchema,
  getSetupSnippetOutputSchema,
  lastFailureResponseSchema,
  listChannelsInputSchema,
  listChannelsOutputSchema,
  listChecksInputSchema,
  listChecksOutputSchema,
  listFlipsInputSchema,
  listFlipsOutputSchema,
  listPingsInputSchema,
  listPingsOutputSchema,
  pingsResponseSchema,
  reportRunInputSchema,
  reportRunOutputSchema,
  reportRunResponseSchema,
  testChannelInputSchema,
  testChannelOutputSchema,
  testChannelResponseSchema,
  updateCheckInputSchema,
  upsertCheckInputSchema,
  type CreateCheckInput,
  type UpdateCheckInput,
  type UpsertCheckInput,
} from "./schemas.js";
import {
  sanitizeChannel,
  sanitizeCheck,
  sanitizeFlip,
  sanitizePing,
  slugifyCheckName,
  type ChannelById,
  type SanitizedChannel,
} from "./sanitize.js";
import { buildSetupSnippet } from "./snippets.js";

export interface WatchgooseToolsOptions {
  apiKey: string;
  apiUrl: string;
  access: AccessLevel;
  enableWrites?: boolean;
  /** Enable hosted-OAuth-only /api/v3/mcp/* tools (get_last_failure, report_run, test_channel). */
  enableMcpEndpoints?: boolean;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  mapError?: (error: unknown) => string;
}

interface RequestContext {
  client: WatchgooseApiClient;
  siteOrigin: string;
  signal: AbortSignal | undefined;
  channelRecords?: Promise<Array<Record<string, unknown>>>;
}

type WritableInput = CreateCheckInput | UpsertCheckInput | Omit<UpdateCheckInput, "unique_key">;

export const TOOL_NAMES = [
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
] as const;

function createContext(options: WatchgooseToolsOptions, signal?: AbortSignal): RequestContext {
  return {
    client: new WatchgooseApiClient({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }),
    siteOrigin: new URL(options.apiUrl).origin,
    signal,
  };
}

function dashboardUrlFor(siteOrigin: string, uniqueKey: string): string {
  return `${siteOrigin}/cloaked/${uniqueKey}/`;
}

async function runTool(
  action: () => Promise<ToolResult>,
  errorMapper: (error: unknown) => string
): Promise<ToolResult> {
  try {
    return await action();
  } catch (error) {
    return errorToolResult(errorMapper(error));
  }
}

async function getChannelRecords(context: RequestContext): Promise<Array<Record<string, unknown>>> {
  context.channelRecords ??= context.client
    .request("channels/", { signal: context.signal })
    .then((value) => channelsResponseSchema.parse(value).channels);
  return context.channelRecords;
}

async function getChannelMap(context: RequestContext): Promise<ChannelById> {
  const map = new Map<string, SanitizedChannel>();
  for (const record of await getChannelRecords(context)) {
    if (typeof record.id !== "string") continue;
    const channel = sanitizeChannel(record);
    if (channel) map.set(record.id, channel);
  }
  return map;
}

async function sanitizeChecks(
  context: RequestContext,
  records: Array<Record<string, unknown>>,
  includeChannels: boolean
): Promise<Array<Record<string, unknown>>> {
  const needsChannels =
    includeChannels &&
    records.some((record) => typeof record.channels === "string" && record.channels.length > 0);
  const channelMap = needsChannels ? await getChannelMap(context) : undefined;
  return Promise.all(
    records.map((record) => sanitizeCheck(record, channelMap, context.siteOrigin))
  );
}

async function resolveCheckReference(
  context: RequestContext,
  uniqueKey: string
): Promise<{ uuid: string; hasChannels: boolean }> {
  const response = apiRecordSchema.parse(
    await context.client.request(`checks/${uniqueKey}`, { signal: context.signal })
  );
  const uuid = typeof response.uuid === "string" ? response.uuid : response.code;
  if (typeof uuid !== "string" || !/^[0-9a-f-]{36}$/i.test(uuid)) {
    throw new InvalidApiResponseError();
  }
  return {
    uuid,
    hasChannels: typeof response.channels === "string" && response.channels.length > 0,
  };
}

async function resolveChannelNames(context: RequestContext, names: string[]): Promise<string> {
  if (names.length === 0) return "";
  const records = await getChannelRecords(context);
  const ids: string[] = [];

  for (const name of names) {
    if (!name) throw new ChannelResolutionError("empty");
    const matches = records.filter(
      (record) => record.name === name && typeof record.id === "string"
    );
    if (matches.length === 0) throw new ChannelResolutionError("missing");
    if (matches.length > 1) throw new ChannelResolutionError("duplicate");
    ids.push(matches[0]!.id as string);
  }

  return ids.join(",");
}

async function prepareWritePayload(
  context: RequestContext,
  input: WritableInput
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || key === "unique_key") continue;
    if (key === "tags") {
      payload.tags = (value as string[]).join(" ");
    } else if (key === "channels") {
      payload.channels = await resolveChannelNames(context, value as string[]);
    } else {
      payload[key] = value;
    }
  }
  return payload;
}

function toHealthCheckRef(check: Record<string, unknown>): Record<string, unknown> {
  const ref: Record<string, unknown> = {
    unique_key: check.unique_key,
    dashboard_url: check.dashboard_url,
  };
  if (typeof check.name === "string") ref.name = check.name;
  if (typeof check.slug === "string") ref.slug = check.slug;
  if (typeof check.status === "string") ref.status = check.status;
  if (typeof check.n_pings === "number") ref.n_pings = check.n_pings;
  if (check.last_ping === null || typeof check.last_ping === "string") {
    ref.last_ping = check.last_ping;
  }
  if (check.next_ping === null || typeof check.next_ping === "string") {
    ref.next_ping = check.next_ping;
  }
  return ref;
}

function signalFromContext(context: {
  mcpReq?: { signal?: AbortSignal };
}): AbortSignal | undefined {
  return context.mcpReq?.signal;
}

export function registerWatchgooseTools(server: McpServer, options: WatchgooseToolsOptions): void {
  const executeTool = (action: () => Promise<ToolResult>) =>
    runTool(action, options.mapError ?? mapToolError);

  server.registerTool(
    "list_checks",
    {
      title: "List Watchgoose checks",
      description:
        "List checks in this Watchgoose project, optionally filtered by slug or tags. A successful ping arms a new check; Watchgoose then expects the next success within its timeout or schedule plus grace period.",
      inputSchema: listChecksInputSchema,
      outputSchema: listChecksOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input, mcpContext) =>
      executeTool(async () => {
        const context = createContext(options, signalFromContext(mcpContext));
        const query = new URLSearchParams();
        if (input.slug !== undefined) query.set("slug", input.slug);
        for (const tag of input.tags ?? []) query.append("tag", tag);
        const suffix = query.size ? `?${query.toString()}` : "";
        const response = checksResponseSchema.parse(
          await context.client.request(`checks/${suffix}`, { signal: context.signal })
        );
        const checks = await sanitizeChecks(
          context,
          response.checks,
          options.access === "read-write"
        );
        return listToolResult("checks", checks, input.limit ?? RESULT_CAPS.checks);
      })
  );

  server.registerTool(
    "get_check",
    {
      title: "Get a Watchgoose check",
      description:
        "Get one check by its stable unique_key, including its current state, dashboard_url, and schedule. Cron and OnCalendar checks use schedule plus grace; simple checks use timeout plus grace.",
      inputSchema: getCheckInputSchema,
      outputSchema: getCheckOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input, mcpContext) =>
      executeTool(async () => {
        const context = createContext(options, signalFromContext(mcpContext));
        const response = apiRecordSchema.parse(
          await context.client.request(`checks/${input.unique_key}`, { signal: context.signal })
        );
        const [check] = await sanitizeChecks(context, [response], options.access === "read-write");
        return objectToolResult("check", check!);
      })
  );

  server.registerTool(
    "list_flips",
    {
      title: "List a check's status changes",
      description:
        "List retained status changes for a check, newest first, with optional time filters. In results, up: 1 means the check became up; up: 0 means any other status, including down, paused, and new after resume. A pause or resume that changes the check's status records a flip.",
      inputSchema: listFlipsInputSchema,
      outputSchema: listFlipsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input, mcpContext) =>
      executeTool(async () => {
        const context = createContext(options, signalFromContext(mcpContext));
        const query = new URLSearchParams();
        if (input.seconds !== undefined) query.set("seconds", String(input.seconds));
        if (input.start !== undefined) query.set("start", String(input.start));
        if (input.end !== undefined) query.set("end", String(input.end));
        const suffix = query.size ? `?${query.toString()}` : "";
        const response = flipsResponseSchema.parse(
          await context.client.request(`checks/${input.unique_key}/flips/${suffix}`, {
            signal: context.signal,
          })
        );
        return listToolResult(
          "flips",
          response.flips.map(sanitizeFlip),
          input.limit ?? RESULT_CAPS.flips
        );
      })
  );

  server.registerTool(
    "get_health_summary",
    {
      title: "Summarize project monitoring health",
      description:
        "Return a concise health summary for this Watchgoose project: counts by status (up, down, grace, new, paused), down or late checks, unarmed checks awaiting their first successful ping, paused checks, and checks missing alert integrations when available.",
      inputSchema: getHealthSummaryInputSchema,
      outputSchema: getHealthSummaryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input, mcpContext) =>
      executeTool(async () => {
        const context = createContext(options, signalFromContext(mcpContext));
        const query = new URLSearchParams();
        for (const tag of input.tags ?? []) query.append("tag", tag);
        const suffix = query.size ? `?${query.toString()}` : "";
        const response = checksResponseSchema.parse(
          await context.client.request(`checks/${suffix}`, { signal: context.signal })
        );
        const isRw = options.access === "read-write";
        const checks = await sanitizeChecks(context, response.checks, isRw);
        const counts = { up: 0, down: 0, grace: 0, new: 0, paused: 0 };
        const downChecks: Array<Record<string, unknown>> = [];
        const graceChecks: Array<Record<string, unknown>> = [];
        const unarmedChecks: Array<Record<string, unknown>> = [];
        const pausedChecks: Array<Record<string, unknown>> = [];
        const withoutChannels: Array<Record<string, unknown>> = [];

        for (let i = 0; i < checks.length; i += 1) {
          const check = checks[i]!;
          const raw = response.checks[i]!;
          const status = typeof check.status === "string" ? check.status : "";
          const ref = toHealthCheckRef(check);
          if (status === "up") counts.up += 1;
          else if (status === "down") {
            counts.down += 1;
            downChecks.push(ref);
          } else if (status === "grace") {
            counts.grace += 1;
            graceChecks.push(ref);
          } else if (status === "new") {
            counts.new += 1;
            unarmedChecks.push(ref);
          } else if (status === "paused") {
            counts.paused += 1;
            pausedChecks.push(ref);
          }

          if (isRw && typeof raw.channels === "string" && raw.channels.trim() === "") {
            withoutChannels.push(ref);
          }
        }

        const isFreshStarterProject =
          checks.length === 1 &&
          checks[0]?.slug === "my-first-check" &&
          checks[0]?.status === "new" &&
          checks[0]?.n_pings === 0;

        const summary: Record<string, unknown> = {
          total: checks.length,
          counts,
          is_fresh_starter_project: isFreshStarterProject,
          down_checks: downChecks.slice(0, 25),
          grace_checks: graceChecks.slice(0, 25),
          unarmed_checks: unarmedChecks.slice(0, 25),
          paused_checks: pausedChecks.slice(0, 25),
        };
        if (isRw) {
          const channelRecords = await getChannelRecords(context);
          summary.checks_without_channels = withoutChannels.slice(0, 25);
          summary.channels_available = channelRecords.length;
        }
        return objectToolResult("summary", summary);
      })
  );

  server.registerTool(
    "get_setup_snippet",
    {
      title: "Generate check setup snippet",
      description:
        "Generate copy-paste heartbeat instrumentation or scheduled AI routine reporting instructions for an existing check on a target platform (cron, systemd, docker, aws-ecs, github-actions, python, rclone, claude-routine, cursor-automation, or codex-automation). Uses environment-variable placeholders and dashboard links; never returns secret ping URLs.",
      inputSchema: getSetupSnippetInputSchema,
      outputSchema: getSetupSnippetOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input, mcpContext) =>
      executeTool(async () => {
        const context = createContext(options, signalFromContext(mcpContext));
        const response = apiRecordSchema.parse(
          await context.client.request(`checks/${input.unique_key}`, { signal: context.signal })
        );
        const check = await sanitizeCheck(response, undefined, context.siteOrigin);
        const setup = buildSetupSnippet({
          platform: input.platform,
          uniqueKey: check.unique_key as string,
          name: typeof check.name === "string" ? check.name : undefined,
          slug: typeof check.slug === "string" ? check.slug : undefined,
          dashboardUrl: check.dashboard_url as string,
          includeStart: input.include_start,
        });
        return objectToolResult("setup", { ...setup });
      })
  );

  if (options.access === "read-write") {
    server.registerTool(
      "list_pings",
      {
        title: "List a check's pings",
        description:
          "List recent signals for a check, newest first. Success arms or advances monitoring, /fail records failure, and /start begins runtime measurement. Source addresses, user agents, run IDs, body URLs, and ping bodies are never returned.",
        inputSchema: listPingsInputSchema,
        outputSchema: listPingsOutputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input, mcpContext) =>
        executeTool(async () => {
          const context = createContext(options, signalFromContext(mcpContext));
          const { uuid } = await resolveCheckReference(context, input.unique_key);
          const response = pingsResponseSchema.parse(
            await context.client.request(`checks/${uuid}/pings/`, { signal: context.signal })
          );
          return listToolResult(
            "pings",
            response.pings.map(sanitizePing),
            input.limit ?? RESULT_CAPS.pings
          );
        })
    );

    server.registerTool(
      "list_channels",
      {
        title: "List Watchgoose integrations",
        description:
          "List integration names and kinds available for check notifications. Only exact, unique integration names can be assigned to checks.",
        inputSchema: listChannelsInputSchema,
        outputSchema: listChannelsOutputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input, mcpContext) =>
        executeTool(async () => {
          const context = createContext(options, signalFromContext(mcpContext));
          const channels = (await getChannelRecords(context))
            .map(sanitizeChannel)
            .filter((channel): channel is SanitizedChannel => channel !== undefined);
          return listToolResult("channels", channels, input.limit ?? RESULT_CAPS.channels);
        })
    );

    if (options.enableMcpEndpoints) {
      server.registerTool(
        "get_last_failure",
        {
          title: "Inspect a check's latest failure",
          description:
            "Return the most recent failure or timeout metadata for a check, including downtime reason, duration, exit status, and whether a log body is attached. Source addresses, user agents, run IDs, ping URLs, and ping body contents are never returned; open dashboard_url to read attached logs.",
          inputSchema: getLastFailureInputSchema,
          outputSchema: getLastFailureOutputSchema,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        (input, mcpContext) =>
          executeTool(async () => {
            const context = createContext(options, signalFromContext(mcpContext));
            const raw = lastFailureResponseSchema.parse(
              await context.client.request(`mcp/checks/${input.unique_key}/last-failure/`, {
                signal: context.signal,
              })
            );
            return objectToolResult("failure", {
              ...raw,
              dashboard_url: dashboardUrlFor(context.siteOrigin, raw.unique_key),
            });
          })
      );
    }
  }

  if (options.access !== "read-write" || !options.enableWrites) return;

  server.registerTool(
    "create_check",
    {
      title: "Create a Watchgoose check",
      description: options.enableMcpEndpoints
        ? "Create a new simple timeout check or cron/OnCalendar schedule check. All fields are optional; schedule takes precedence over timeout. When slug is omitted and name is provided, a URL-safe slug is generated automatically. When channels is omitted, all existing project alert integrations are assigned automatically; pass channels: [] to assign none. New checks remain unarmed until their first successful ping, and this server never returns ping URLs: share the returned dashboard_url so the user can copy its ping URL into their job, or report scheduled AI runs directly."
        : "Create a new simple timeout check or cron/OnCalendar schedule check. All fields are optional; schedule takes precedence over timeout. When slug is omitted and name is provided, a URL-safe slug is generated automatically. When channels is omitted, all existing project alert integrations are assigned automatically; pass channels: [] to assign none. New checks remain unarmed until their first successful ping, and this server never returns ping URLs: share the returned dashboard_url so the user can copy its ping URL into their job.",
      inputSchema: createCheckInputSchema,
      outputSchema: getCheckOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input, mcpContext) =>
      executeTool(async () => {
        const context = createContext(options, signalFromContext(mcpContext));
        const payload = await prepareWritePayload(context, input);
        if (input.slug === undefined && typeof input.name === "string" && input.name.trim()) {
          const generatedSlug = slugifyCheckName(input.name);
          if (generatedSlug) payload.slug = generatedSlug;
        }
        if (input.channels === undefined) {
          payload.channels = "*";
        }
        const channelMap =
          input.channels === undefined || input.channels.length > 0
            ? await getChannelMap(context)
            : undefined;
        const response = apiRecordSchema.parse(
          await context.client.request("checks/", {
            method: "POST",
            body: payload,
            signal: context.signal,
          })
        );
        return objectToolResult(
          "check",
          await sanitizeCheck(response, channelMap, context.siteOrigin)
        );
      })
  );

  server.registerTool(
    "upsert_check",
    {
      title: "Create or update a Watchgoose check by matching fields",
      description:
        "Match an existing check by the specified unique fields and update its supplied settings, or create a new check if none match. Supplied settings replace existing values on a matched check, channels: [] removes all alert integration assignments, and omitted fields remain unchanged on a matched check (when creating a new check, omitting channels assigns none).",
      inputSchema: upsertCheckInputSchema,
      outputSchema: getCheckOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input, mcpContext) =>
      executeTool(async () => {
        const context = createContext(options, signalFromContext(mcpContext));
        const payload = await prepareWritePayload(context, input);
        const channelMap = input.channels?.length ? await getChannelMap(context) : undefined;
        const response = apiRecordSchema.parse(
          await context.client.request("checks/", {
            method: "POST",
            body: payload,
            signal: context.signal,
          })
        );
        return objectToolResult(
          "check",
          await sanitizeCheck(response, channelMap, context.siteOrigin)
        );
      })
  );

  server.registerTool(
    "update_check",
    {
      title: "Update a Watchgoose check",
      description:
        "Update selected fields on an existing check. Omitted fields remain unchanged; schedule takes precedence over timeout, and integration names must match exactly.",
      inputSchema: updateCheckInputSchema,
      outputSchema: getCheckOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input, mcpContext) =>
      executeTool(async () => {
        const context = createContext(options, signalFromContext(mcpContext));
        const target = await resolveCheckReference(context, input.unique_key);
        const payload = await prepareWritePayload(context, input);
        const needsChannelMap =
          (input.channels === undefined && target.hasChannels) || Boolean(input.channels?.length);
        const channelMap = needsChannelMap ? await getChannelMap(context) : undefined;
        const response = apiRecordSchema.parse(
          await context.client.request(`checks/${target.uuid}`, {
            method: "POST",
            body: payload,
            signal: context.signal,
          })
        );
        return objectToolResult(
          "check",
          await sanitizeCheck(response, channelMap, context.siteOrigin)
        );
      })
  );

  server.registerTool(
    "pause_check",
    {
      title: "Pause a Watchgoose check",
      description:
        "Pause monitoring without deleting the check. Unless manual_resume is enabled, a later ping can automatically resume a paused check.",
      inputSchema: checkStateInputSchema,
      outputSchema: getCheckOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input, mcpContext) =>
      executeTool(async () => {
        const context = createContext(options, signalFromContext(mcpContext));
        const target = await resolveCheckReference(context, input.unique_key);
        const channelMap = target.hasChannels ? await getChannelMap(context) : undefined;
        const response = apiRecordSchema.parse(
          await context.client.request(`checks/${target.uuid}/pause`, {
            method: "POST",
            signal: context.signal,
          })
        );
        return objectToolResult(
          "check",
          await sanitizeCheck(response, channelMap, context.siteOrigin)
        );
      })
  );

  server.registerTool(
    "resume_check",
    {
      title: "Resume a Watchgoose check",
      description:
        "Resume a paused check and return it to the new state. The next successful ping arms its monitoring schedule.",
      inputSchema: checkStateInputSchema,
      outputSchema: getCheckOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input, mcpContext) =>
      executeTool(async () => {
        const context = createContext(options, signalFromContext(mcpContext));
        const target = await resolveCheckReference(context, input.unique_key);
        const channelMap = target.hasChannels ? await getChannelMap(context) : undefined;
        const response = apiRecordSchema.parse(
          await context.client.request(`checks/${target.uuid}/resume`, {
            method: "POST",
            signal: context.signal,
          })
        );
        return objectToolResult(
          "check",
          await sanitizeCheck(response, channelMap, context.siteOrigin)
        );
      })
  );

  server.registerTool(
    "delete_check",
    {
      title: "Delete a Watchgoose check",
      description:
        "Permanently delete a check and its retained monitoring history. This cannot be undone.",
      inputSchema: checkStateInputSchema,
      outputSchema: deleteCheckOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input, mcpContext) =>
      executeTool(async () => {
        const context = createContext(options, signalFromContext(mcpContext));
        const target = await resolveCheckReference(context, input.unique_key);
        const channelMap = target.hasChannels ? await getChannelMap(context) : undefined;
        const response = apiRecordSchema.parse(
          await context.client.request(`checks/${target.uuid}`, {
            method: "DELETE",
            signal: context.signal,
          })
        );
        return objectToolResult(
          "deleted",
          await sanitizeCheck(response, channelMap, context.siteOrigin)
        );
      })
  );

  if (!options.enableMcpEndpoints) return;

  server.registerTool(
    "report_run",
    {
      title: "Report a job or agent run signal",
      description:
        "Record a real start, success, fail, or log signal for a check directly through Watchgoose without exposing a ping URL. Designed strictly for scheduled AI routines and agent workflows. Never call this as a synthetic test ping after creating a check for an external cron, systemd, Docker, or CI job: a success signal arms the schedule immediately and causes false down alerts when no real job follows.",
      inputSchema: reportRunInputSchema,
      outputSchema: reportRunOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input, mcpContext) =>
      executeTool(async () => {
        const context = createContext(options, signalFromContext(mcpContext));
        const payload: Record<string, unknown> = { status: input.status };
        if (input.exit_status !== undefined) payload.exit_status = input.exit_status;
        if (input.summary !== undefined) payload.summary = input.summary;
        if (input.rid !== undefined) payload.rid = input.rid;
        const raw = reportRunResponseSchema.parse(
          await context.client.request(`mcp/checks/${input.unique_key}/report/`, {
            method: "POST",
            body: payload,
            signal: context.signal,
          })
        );
        return objectToolResult("report", {
          unique_key: raw.unique_key,
          dashboard_url: dashboardUrlFor(context.siteOrigin, raw.unique_key),
          name: raw.name,
          slug: raw.slug,
          action: raw.action,
          status: raw.status,
          started: raw.started,
          n_pings: raw.n_pings,
          last_ping: raw.last_ping,
          next_ping: raw.next_ping,
          last_duration: raw.last_duration ?? null,
        });
      })
  );

  server.registerTool(
    "test_channel",
    {
      title: "Send a test alert notification",
      description:
        "Send a test notification to a named alert integration in this project to verify delivery. Requires an exact, unique integration name and is rate-limited per integration. Metered SMS, phone call, and WhatsApp integrations (or groups containing them) cannot be tested here and must be tested from the Watchgoose dashboard.",
      inputSchema: testChannelInputSchema,
      outputSchema: testChannelOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input, mcpContext) =>
      executeTool(async () => {
        const context = createContext(options, signalFromContext(mcpContext));
        const raw = testChannelResponseSchema.parse(
          await context.client.request("mcp/channels/test/", {
            method: "POST",
            body: { name: input.name },
            signal: context.signal,
          })
        );
        return objectToolResult("result", { ...raw });
      })
  );
}
