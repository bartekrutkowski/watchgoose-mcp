import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as z from "zod/v4";
import {
  createCheckInputSchema,
  getCheckInputSchema,
  listChecksInputSchema,
  listFlipsInputSchema,
  listPingsInputSchema,
} from "../../packages/core/src/schemas.js";

import { sanitizeCheck, sanitizePing } from "../../packages/core/src/sanitize.js";

const root = process.cwd();
const skillNames = [
  "watchgoose-cron-coverage-audit",
  "watchgoose-monitor-scheduled-job",
  "watchgoose-missed-run-triage",
  "watchgoose-monitoring-health-review",
  "watchgoose-batch-monitor-scheduled-jobs",
];
const name = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const author = z.object({ name: z.string().min(1), url: z.url() }).strict();
const metadata = {
  name,
  version,
  description: z.string().min(1),
  author,
  homepage: z.url(),
  repository: z.url(),
  license: z.literal("MIT"),
};
function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parsedSkill(skillName: string) {
  const path = resolve(root, "skills", skillName, "SKILL.md");
  const text = readFileSync(path, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/);
  expect(match, "skill must have bounded YAML frontmatter and a body").toBeTruthy();
  // Read this bundle's plain scalar subset, including Prettier's indented folding.
  // Official skills-ref validation separately checks complete YAML semantics.
  const frontmatter: Record<string, string> = {};
  let field: string | undefined;
  for (const line of match![1]!.split("\n")) {
    const pair = line.match(/^([a-z-]+):(?: (.*))?$/);
    if (pair) {
      field = pair[1]!;
      expect(Object.hasOwn(frontmatter, field), "duplicate metadata field").toBe(false);
      frontmatter[field] = pair[2] ?? "";
    } else {
      expect(field !== undefined && /^ {2}\S/.test(line), "plain scalar continuation").toBe(true);
      frontmatter[field!] = `${frontmatter[field!]} ${line.trim()}`.trim();
    }
  }
  const parsed = z
    .object({ name, description: z.string().min(1).max(1024) })
    .strict()
    .parse(frontmatter);
  expect(parsed.name).toBe(skillName);
  return { path, body: match![2]!, metadata: parsed };
}

describe("canonical skills and platform adapters", () => {
  it.each(skillNames)("%s is individually loadable with contained references", (skillName) => {
    const skill = parsedSkill(skillName);
    expect(skill.body.trim().split(/\s+/).length).toBeLessThanOrEqual(500);
    for (const match of skill.body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1]!;
      if (/^https:\/\//.test(target)) continue;
      expect(isAbsolute(target)).toBe(false);
      const linked = resolve(dirname(skill.path), target);
      const local = relative(dirname(skill.path), linked);
      expect(local === ".." || local.startsWith("../")).toBe(false);
      expect(existsSync(linked), `missing skill reference: ${target}`).toBe(true);
    }
  });

  it("Claude discovers the canonical skills without copied instruction trees", () => {
    z.object(metadata).strict().parse(json(".claude-plugin/plugin.json"));
    const loadedNames = readdirSync(resolve(root, "skills")).filter((entry) =>
      existsSync(resolve(root, "skills", entry, "SKILL.md"))
    );
    expect(loadedNames.sort()).toEqual([...skillNames].sort());
  });

  it("portable metadata contains only supported identity fields and no auto-execution", () => {
    const portable = z
      .object({
        $schema: z.literal("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"),
        ...metadata,
        keywords: z.array(z.string()),
      })
      .strict()
      .parse(json("plugin.json"));
    const claude = z.object(metadata).strict().parse(json(".claude-plugin/plugin.json"));
    expect(portable.name).toBe(claude.name);
    expect(portable.version).toBe(claude.version);
    expect(existsSync("hooks")).toBe(false);
    expect(existsSync(".app.json")).toBe(false);
  });

  it("the skills' constrained payload vocabulary and bounds match the actual MCP schemas", () => {
    expect(Object.keys(listChecksInputSchema.shape).sort()).toEqual(["limit", "slug", "tags"]);
    expect(Object.keys(listFlipsInputSchema.shape).sort()).toEqual([
      "end",
      "limit",
      "seconds",
      "start",
      "unique_key",
    ]);
    for (const limit of [1, 100])
      expect(listChecksInputSchema.safeParse({ limit }).success).toBe(true);
    for (const limit of [0, 101])
      expect(listChecksInputSchema.safeParse({ limit }).success).toBe(false);
    const unique_key = "a".repeat(40);
    expect(getCheckInputSchema.safeParse({ unique_key }).success).toBe(true);
    for (const invalid of ["backup-nightly", "A".repeat(40), "a".repeat(39)])
      expect(getCheckInputSchema.safeParse({ unique_key: invalid }).success).toBe(false);
    expect(getCheckInputSchema.safeParse({ slug: "backup-nightly" }).success).toBe(false);
    expect(Object.keys(listPingsInputSchema.shape).sort()).toEqual(["limit", "unique_key"]);
    for (const limit of [1, 100])
      expect(listPingsInputSchema.safeParse({ unique_key, limit }).success).toBe(true);
    for (const limit of [0, 101])
      expect(listPingsInputSchema.safeParse({ unique_key, limit }).success).toBe(false);
    expect(listPingsInputSchema.safeParse({ unique_key, start: 0 }).success).toBe(false);
    for (const limit of [1, 200])
      expect(listFlipsInputSchema.safeParse({ unique_key, limit }).success).toBe(true);
    for (const limit of [0, 201])
      expect(listFlipsInputSchema.safeParse({ unique_key, limit }).success).toBe(false);
    expect(createCheckInputSchema.safeParse({ timeout: 60, grace: 60 }).success).toBe(true);
    expect(createCheckInputSchema.safeParse({ timeout: 59 }).success).toBe(false);
    expect(createCheckInputSchema.safeParse({ grace: 59 }).success).toBe(false);
    expect(
      createCheckInputSchema.safeParse({
        name: "Export",
        slug: "export-hourly",
        timeout: 3600,
        grace: 600,
      }).success
    ).toBe(true);
    expect(
      createCheckInputSchema.safeParse({
        name: "Export",
        timeout: 3600,
        schedule_type: "interval",
        interval_value: 1,
      }).success
    ).toBe(false);
  });

  it("triage ping evidence preserves signal metadata without private payload fields", () => {
    const ping = sanitizePing({
      type: "fail",
      date: "2026-10-05T02:03:00Z",
      n: 5,
      scheme: "https",
      method: "POST",
      duration: 120,
      remote_addr: "192.0.2.7",
      ua: "synthetic-agent",
      rid: "synthetic-run-id",
      body_url: "https://example.invalid/private-canary",
      body: "synthetic-body",
    });
    expect(ping).toEqual({
      type: "fail",
      date: "2026-10-05T02:03:00Z",
      n: 5,
      scheme: "https",
      method: "POST",
      duration: 120,
    });
  });

  it("health-review routing evidence can omit unresolved assignments without exposing private IDs", async () => {
    const channels = new Map([["resolved-id", { name: "Ops", kind: "email" }]]);
    expect(
      await sanitizeCheck(
        { unique_key: "a".repeat(40), channels: "resolved-id,missing-id" },
        channels
      )
    ).toEqual({ unique_key: "a".repeat(40), channels: [{ name: "Ops", kind: "email" }] });
    expect(
      await sanitizeCheck({ unique_key: "a".repeat(40), channels: "missing-id" }, channels)
    ).toEqual({ unique_key: "a".repeat(40), channels: [] });
  });

  it("the setup reference's executable input examples validate against the real creation schema", () => {
    const guide = readFileSync("skills/watchgoose-monitor-scheduled-job/contracts.md", "utf8");
    const examples = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)];
    expect(examples).toHaveLength(2);
    for (const example of examples) {
      const input: unknown = JSON.parse(example[1]!);
      expect(createCheckInputSchema.safeParse(input).success).toBe(true);
    }
  });

  it("the batch proposal example supplies only valid plain-new creation inputs", () => {
    const guide = readFileSync(
      "skills/watchgoose-batch-monitor-scheduled-jobs/proposal.md",
      "utf8"
    );
    const blocks = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)];
    expect(blocks).toHaveLength(1);
    const rows = z
      .array(z.object({ row: z.string(), source: z.string(), input: z.unknown() }).strict())
      .parse(JSON.parse(blocks[0]![1]!));
    expect(rows).toHaveLength(2);
    const plainCreate = createCheckInputSchema.omit({ unique: true }).strict();
    for (const row of rows) expect(plainCreate.safeParse(row.input).success).toBe(true);
  });

  it("behavioral fixtures refer to loadable skills and uniquely identified scenarios", () => {
    const skill = z.enum(skillNames);
    const fixtures = z
      .object({
        format: z.number().optional(),
        notice: z.string().optional(),
        scenarios: z
          .array(
            z
              .object({
                id: z.string().min(1),
                skill,
                prompt: z.string().min(1),
                expected_behavior: z.array(z.string().min(1)).min(1),
                forbidden_behavior: z.array(z.string().min(1)).min(1),
              })
              .strict()
          )
          .min(1),
        selection: z
          .array(z.object({ prompt: z.string().min(1), expected: skill.nullable() }).strict())
          .min(1),
      })
      .strict();
    const ids: string[] = [];
    for (const path of ["tests/skills/scenarios.json", "tests/skills/expansion-scenarios.json"])
      ids.push(...fixtures.parse(json(path)).scenarios.map((scenario) => scenario.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("both MCP adapters use only the existing hosted endpoint, without credentials", () => {
    const url = z.literal("https://mcp.watchgoose.com/mcp");
    const claude = z
      .object({
        mcpServers: z
          .object({ watchgoose: z.object({ type: z.literal("http"), url }).strict() })
          .strict(),
      })
      .strict()
      .parse(json(".mcp.json"));
    const portable = z
      .object({
        $schema: z.literal("https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"),
        mcpServers: z
          .object({ watchgoose: z.object({ type: z.literal("streamable-http"), url }).strict() })
          .strict(),
      })
      .strict()
      .parse(json("mcp.json"));
    expect(portable.mcpServers.watchgoose.url).toBe(claude.mcpServers.watchgoose.url);
  });
});
