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
  name: z.string().max(100).optional(),
  slug: slugSchema.optional(),
  tags: tagsSchema.optional(),
  desc: z.string().max(10_000).optional(),
  timeout: z.number().int().min(60).max(31_536_000).optional(),
  grace: z.number().int().min(60).max(31_536_000).optional(),
  schedule: z.string().max(100).optional(),
  tz: z.string().max(100).optional(),
  manual_resume: z.boolean().optional(),
  methods: z.enum(["", "POST"]).optional(),
  channels: z.array(channelNameSchema).max(100).optional(),
  start_kw: z.string().max(200).optional(),
  success_kw: z.string().max(200).optional(),
  failure_kw: z.string().max(200).optional(),
  filter_subject: z.boolean().optional(),
  filter_body: z.boolean().optional(),
  filter_http_body: z.boolean().optional(),
  filter_default_fail: z.boolean().optional(),
} as const;

export const listChecksInputSchema = z
  .object({
    slug: slugSchema.optional(),
    tags: tagsSchema.optional(),
    limit: z.number().int().min(1).max(RESULT_CAPS.checks).optional(),
  })
  .strict();

export const getCheckInputSchema = z.object({ unique_key: uniqueKeySchema }).strict();

export const createCheckInputSchema = z
  .object({
    ...writableFields,
    unique: z
      .array(z.enum(["name", "slug", "tags", "timeout", "grace"]))
      .max(5)
      .optional(),
  })
  .strict();

export const updateCheckInputSchema = z
  .object({ unique_key: uniqueKeySchema, ...writableFields })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "unique_key"),
    "Provide at least one field to update"
  );

export const checkStateInputSchema = z.object({ unique_key: uniqueKeySchema }).strict();

export const listPingsInputSchema = z
  .object({
    unique_key: uniqueKeySchema,
    limit: z.number().int().min(1).max(RESULT_CAPS.pings).optional(),
  })
  .strict();

export const listFlipsInputSchema = z
  .object({
    unique_key: uniqueKeySchema,
    seconds: z.number().int().min(0).max(31_536_000).optional(),
    start: z.number().int().min(0).max(10_000_000_000).optional(),
    end: z.number().int().min(0).max(10_000_000_000).optional(),
    limit: z.number().int().min(1).max(RESULT_CAPS.flips).optional(),
  })
  .strict();

export const listChannelsInputSchema = z
  .object({ limit: z.number().int().min(1).max(RESULT_CAPS.channels).optional() })
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
