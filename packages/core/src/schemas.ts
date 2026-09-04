import * as z from "zod/v4";
import { RESULT_CAPS } from "./constants.js";

export const SAFE_CHECK_FIELDS = [
  "name",
  "slug",
  "tags",
  "desc",
  "grace",
  "n_pings",
  "status",
  "started",
  "last_ping",
  "next_ping",
  "last_duration",
  "manual_resume",
  "methods",
  "subject",
  "subject_fail",
  "start_kw",
  "success_kw",
  "failure_kw",
  "filter_subject",
  "filter_body",
  "filter_http_body",
  "filter_default_fail",
  "timeout",
  "schedule",
  "tz",
] as const;
export const SAFE_PING_FIELDS = ["type", "date", "n", "scheme", "method", "duration"] as const;
export const SAFE_FLIP_FIELDS = ["timestamp", "up"] as const;
export const SAFE_CHANNEL_FIELDS = ["name", "kind"] as const;

export const uniqueKeySchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "Expected a lowercase 40-character unique_key");
const inputUniqueKeySchema = uniqueKeySchema.describe(
  "40-character stable check identifier from list_checks."
);

const slugSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9_-]*$/, "Use lowercase letters, numbers, hyphens, or underscores");
const tagSchema = z.string().min(1).max(100).regex(/^\S+$/, "Tags cannot contain whitespace");
const tagsSchema = z
  .array(tagSchema)
  .max(100)
  .refine((tags) => tags.join(" ").length <= 500, "Combined tags must not exceed 500 characters");
const channelNameSchema = z.string().min(1).max(200);

const writableFields = {
  name: z
    .string()
    .max(100)
    .optional()
    .describe('Human-readable check name, for example "Nightly backup".'),
  slug: slugSchema
    .optional()
    .describe(
      'Check slug using lowercase letters, numbers, hyphens, or underscores, for example "nightly-backup".'
    ),
  tags: tagsSchema
    .optional()
    .describe('Check tags as non-whitespace strings, for example ["production", "backup"].'),
  desc: z.string().max(10_000).optional().describe("Free-form description of the monitored job."),
  timeout: z
    .number()
    .int()
    .min(60)
    .max(31_536_000)
    .optional()
    .describe("Expected interval between successful pings, in seconds; used for simple checks."),
  grace: z
    .number()
    .int()
    .min(60)
    .max(31_536_000)
    .optional()
    .describe("Extra time after a missed deadline before the check goes down, in seconds."),
  schedule: z
    .string()
    .max(100)
    .optional()
    .describe("Cron or systemd OnCalendar expression; when set, it takes precedence over timeout."),
  tz: z
    .string()
    .max(100)
    .optional()
    .describe('IANA timezone for schedule evaluation, for example "Europe/Riga".'),
  manual_resume: z
    .boolean()
    .optional()
    .describe("When true, pings cannot automatically resume a paused check."),
  methods: z
    .enum(["", "POST"])
    .optional()
    .describe('Allowed ping methods: "" permits HEAD, GET, and POST; "POST" permits only POST.'),
  channels: z
    .array(channelNameSchema)
    .max(100)
    .optional()
    .describe("Exact, unique integration names to assign; an empty array removes all assignments."),
  start_kw: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Comma-separated, case-sensitive keywords that classify matching email or HTTP ping content as a start."
    ),
  success_kw: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Comma-separated, case-sensitive keywords that classify matching email or HTTP ping content as a success."
    ),
  failure_kw: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Comma-separated, case-sensitive keywords that classify matching email or HTTP ping content as a failure."
    ),
  filter_subject: z
    .boolean()
    .optional()
    .describe("When true, apply keyword rules to inbound email subject lines."),
  filter_body: z
    .boolean()
    .optional()
    .describe("When true, apply keyword rules to inbound email bodies."),
  filter_http_body: z
    .boolean()
    .optional()
    .describe("When true, apply keyword rules to HTTP ping request bodies."),
  filter_default_fail: z
    .boolean()
    .optional()
    .describe(
      "When true, classify filtered pings with no keyword match as failures; otherwise ignore them."
    ),
} as const;

export const listChecksInputSchema = z
  .object({
    slug: slugSchema
      .optional()
      .describe(
        "Exact check slug to match, using lowercase letters, numbers, hyphens, or underscores."
      ),
    tags: tagsSchema
      .optional()
      .describe('Tags that every returned check must have, for example ["production", "backup"].'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(RESULT_CAPS.checks)
      .optional()
      .describe("Maximum number of checks to return, from 1 to 100."),
  })
  .strict();

export const getCheckInputSchema = z.object({ unique_key: inputUniqueKeySchema }).strict();

export const createCheckInputSchema = z
  .object({
    ...writableFields,
    unique: z
      .array(z.enum(["name", "slug", "tags", "timeout", "grace"]))
      .max(5)
      .optional()
      .describe(
        'Fields used for upsert matching before creation: name, slug, tags, timeout, or grace; for example ["name"].'
      ),
  })
  .strict();

export const updateCheckInputSchema = z
  .object({ unique_key: inputUniqueKeySchema, ...writableFields })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "unique_key"),
    "Provide at least one field to update"
  );

export const checkStateInputSchema = z.object({ unique_key: inputUniqueKeySchema }).strict();

export const listPingsInputSchema = z
  .object({
    unique_key: inputUniqueKeySchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(RESULT_CAPS.pings)
      .optional()
      .describe("Maximum number of recent pings to return, from 1 to 100."),
  })
  .strict();

export const listFlipsInputSchema = z
  .object({
    unique_key: inputUniqueKeySchema,
    seconds: z
      .number()
      .int()
      .min(0)
      .max(31_536_000)
      .optional()
      .describe(
        "Lookback window for status changes in seconds, from 0 to 31536000; for example 3600."
      ),
    start: z
      .number()
      .int()
      .min(0)
      .max(10_000_000_000)
      .optional()
      .describe(
        "Inclusive lower bound for status-change timestamps, as Unix seconds; for example 1592214380."
      ),
    end: z
      .number()
      .int()
      .min(0)
      .max(10_000_000_000)
      .optional()
      .describe(
        "Exclusive upper bound for status-change timestamps, as Unix seconds; for example 1592217980."
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(RESULT_CAPS.flips)
      .optional()
      .describe("Maximum number of status changes to return, from 1 to 200."),
  })
  .strict();

export const listChannelsInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(RESULT_CAPS.channels)
      .optional()
      .describe("Maximum number of integrations to return, from 1 to 100."),
  })
  .strict();

const safeScalarOutputSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

function optionalScalarShape<const T extends readonly string[]>(
  fields: T
): { [K in T[number]]: z.ZodOptional<typeof safeScalarOutputSchema> } {
  return Object.fromEntries(fields.map((field) => [field, safeScalarOutputSchema.optional()])) as {
    [K in T[number]]: z.ZodOptional<typeof safeScalarOutputSchema>;
  };
}

function requiredStringShape<const T extends readonly string[]>(
  fields: T
): { [K in T[number]]: z.ZodString } {
  return Object.fromEntries(fields.map((field) => [field, z.string()])) as {
    [K in T[number]]: z.ZodString;
  };
}

const sanitizedChannelOutputSchema = z.object(requiredStringShape(SAFE_CHANNEL_FIELDS)).strict();
const sanitizedCheckOutputSchema = z
  .object({
    unique_key: uniqueKeySchema,
    ...optionalScalarShape(SAFE_CHECK_FIELDS),
    channels: z.array(sanitizedChannelOutputSchema).optional(),
  })
  .strict();
const sanitizedPingOutputSchema = z.object(optionalScalarShape(SAFE_PING_FIELDS)).strict();
const sanitizedFlipOutputSchema = z.object(optionalScalarShape(SAFE_FLIP_FIELDS)).strict();
const listMetaOutputSchema = z
  .object({
    returned: z.number().int().nonnegative(),
    available_in_response: z.number().int().nonnegative(),
    omitted: z.number().int().nonnegative(),
    truncated: z.boolean(),
    truncated_fields: z.literal(true).optional(),
  })
  .strict();
const objectMetaOutputSchema = z.object({ truncated_fields: z.literal(true) }).strict();

export const listChecksOutputSchema = z
  .object({
    checks: z.array(sanitizedCheckOutputSchema).max(RESULT_CAPS.checks),
    meta: listMetaOutputSchema,
  })
  .strict();
export const getCheckOutputSchema = z
  .object({ check: sanitizedCheckOutputSchema, meta: objectMetaOutputSchema.optional() })
  .strict();
export const listPingsOutputSchema = z
  .object({
    pings: z.array(sanitizedPingOutputSchema).max(RESULT_CAPS.pings),
    meta: listMetaOutputSchema,
  })
  .strict();
export const listFlipsOutputSchema = z
  .object({
    flips: z.array(sanitizedFlipOutputSchema).max(RESULT_CAPS.flips),
    meta: listMetaOutputSchema,
  })
  .strict();
export const listChannelsOutputSchema = z
  .object({
    channels: z.array(sanitizedChannelOutputSchema).max(RESULT_CAPS.channels),
    meta: listMetaOutputSchema,
  })
  .strict();
export const deleteCheckOutputSchema = z
  .object({ deleted: sanitizedCheckOutputSchema, meta: objectMetaOutputSchema.optional() })
  .strict();

export const apiRecordSchema = z.record(z.string(), z.unknown());
export const checksResponseSchema = z.object({ checks: z.array(apiRecordSchema) });
export const pingsResponseSchema = z.object({ pings: z.array(apiRecordSchema) });
export const flipsResponseSchema = z.object({ flips: z.array(apiRecordSchema) });
export const channelsResponseSchema = z.object({ channels: z.array(apiRecordSchema) });

export type CreateCheckInput = z.infer<typeof createCheckInputSchema>;
export type UpdateCheckInput = z.infer<typeof updateCheckInputSchema>;
