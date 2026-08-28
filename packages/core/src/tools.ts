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
  flipsResponseSchema,
  getCheckInputSchema,
  listChannelsInputSchema,
  listChecksInputSchema,
  listFlipsInputSchema,
  listPingsInputSchema,
  pingsResponseSchema,
  updateCheckInputSchema,
  type CreateCheckInput,
  type UpdateCheckInput,
} from "./schemas.js";
import {
  sanitizeChannel,
  sanitizeCheck,
  sanitizeFlip,
  sanitizePing,
  type ChannelById,
  type SanitizedChannel,
} from "./sanitize.js";

export interface WatchgooseToolsOptions {
  apiKey: string;
  apiUrl: string;
  access: AccessLevel;
  enableWrites?: boolean;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  mapError?: (error: unknown) => string;
}

interface RequestContext {
  client: WatchgooseApiClient;
  signal: AbortSignal | undefined;
  channelRecords?: Promise<Array<Record<string, unknown>>>;
}

type WritableInput = CreateCheckInput | Omit<UpdateCheckInput, "unique_key">;

export const TOOL_NAMES = [
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
] as const;

function createContext(options: WatchgooseToolsOptions, signal?: AbortSignal): RequestContext {
  return {
    client: new WatchgooseApiClient({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }),
    signal,
  };
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
  return Promise.all(records.map((record) => sanitizeCheck(record, channelMap)));
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
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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
        "Get one check by its stable unique_key, including its current state and schedule. Cron and OnCalendar checks use schedule plus grace; simple checks use timeout plus grace.",
      inputSchema: getCheckInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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

  if (options.access === "read-write") {
    server.registerTool(
      "list_pings",
      {
        title: "List a check's pings",
        description:
          "List recent signals for a check, newest first. Success arms or advances monitoring, /fail records failure, and /start begins runtime measurement. Source addresses, user agents, run IDs, body URLs, and ping bodies are never returned.",
        inputSchema: listPingsInputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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
  }

  server.registerTool(
    "list_flips",
    {
      title: "List a check's status changes",
      description:
        "List retained status changes for a check, newest first, with optional time filters. In results, up: 1 means the check became up; up: 0 means any other status, including down, paused, and new after resume. A pause or resume that changes the check's status records a flip.",
      inputSchema: listFlipsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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

  if (options.access === "read-write") {
    server.registerTool(
      "list_channels",
      {
        title: "List Watchgoose integrations",
        description:
          "List integration names and kinds available for check notifications. Use exact, unique names when assigning integrations with create_check or update_check.",
        inputSchema: listChannelsInputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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
  }

  if (options.access !== "read-write" || !options.enableWrites) return;

  server.registerTool(
    "create_check",
    {
      title: "Create a Watchgoose check",
      description:
        "Create a simple timeout check or a cron/OnCalendar schedule check. All fields are optional; schedule takes precedence over timeout. The new check remains unarmed until its first successful ping.",
      inputSchema: createCheckInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
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
        return objectToolResult("check", await sanitizeCheck(response, channelMap));
      })
  );

  server.registerTool(
    "update_check",
    {
      title: "Update a Watchgoose check",
      description:
        "Update selected fields on an existing check. Omitted fields remain unchanged; schedule takes precedence over timeout, and integration names must match exactly.",
      inputSchema: updateCheckInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
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
        return objectToolResult("check", await sanitizeCheck(response, channelMap));
      })
  );

  server.registerTool(
    "pause_check",
    {
      title: "Pause a Watchgoose check",
      description:
        "Pause monitoring without deleting the check. Unless manual_resume is enabled, a later ping can automatically resume a paused check.",
      inputSchema: checkStateInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
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
        return objectToolResult("check", await sanitizeCheck(response, channelMap));
      })
  );

  server.registerTool(
    "resume_check",
    {
      title: "Resume a Watchgoose check",
      description:
        "Resume a paused check and return it to the new state. The next successful ping arms its monitoring schedule.",
      inputSchema: checkStateInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
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
        return objectToolResult("check", await sanitizeCheck(response, channelMap));
      })
  );

  server.registerTool(
    "delete_check",
    {
      title: "Delete a Watchgoose check",
      description:
        "Permanently delete a check and its retained monitoring history. This cannot be undone; pause_check is the reversible alternative.",
      inputSchema: checkStateInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
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
        return objectToolResult("deleted", await sanitizeCheck(response, channelMap));
      })
  );
}
