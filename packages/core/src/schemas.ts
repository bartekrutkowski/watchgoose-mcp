import * as z from "zod/v4";
import { RESULT_CAPS } from "./constants.js";

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

export const apiRecordSchema = z.record(z.string(), z.unknown());
export const checksResponseSchema = z.object({ checks: z.array(apiRecordSchema) });
export const pingsResponseSchema = z.object({ pings: z.array(apiRecordSchema) });
export const flipsResponseSchema = z.object({ flips: z.array(apiRecordSchema) });
export const channelsResponseSchema = z.object({ channels: z.array(apiRecordSchema) });

export type CreateCheckInput = z.infer<typeof createCheckInputSchema>;
export type UpdateCheckInput = z.infer<typeof updateCheckInputSchema>;
