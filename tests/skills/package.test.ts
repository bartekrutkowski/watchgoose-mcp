import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
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
const pluginRoot = resolve(root, "plugins", "watchgoose-monitoring");
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
  keywords: z.array(z.string().refine((keyword) => keyword.trim().length > 0)).min(1),
};
const claudeMetadata = z
  .object({
    ...metadata,
    icon: z.literal("./.claude-plugin/icon.png"),
    privacyPolicyUrl: z.url({ protocol: /^https$/ }),
    termsOfServiceUrl: z.url({ protocol: /^https$/ }),
    displayName: z.literal("Watchgoose Monitoring"),
    documentationUrl: z.url({ protocol: /^https$/ }),
    supportUrl: z.url({ protocol: /^https$/ }),
  })
  .strict();

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function pluginJson(path: string): unknown {
  return json(resolve(pluginRoot, path));
}

function packageFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    const local = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path);
    expect(stat.isSymbolicLink(), `symbolic link: ${local}`).toBe(false);
    if (stat.isDirectory()) return packageFiles(path, local);
    expect(stat.isFile(), `not a regular file: ${local}`).toBe(true);
    expect(stat.mode & 0o111, `executable file: ${local}`).toBe(0);
    return [local];
  });
}

function canonicalSkillFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", "node_modules", "dist"].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return canonicalSkillFiles(path);
    return entry.name === "SKILL.md" ? [path] : [];
  });
}

function parsedSkill(skillName: string) {
  const path = resolve(pluginRoot, "skills", skillName, "SKILL.md");
  const text = readFileSync(path, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/);
  expect(match, "skill must have bounded YAML frontmatter and a body").toBeTruthy();
  // Read this bundle's scalar subset: inline values or `>-` folded blocks.
  // Official skills-ref validation separately checks complete YAML semantics.
  const frontmatter: Record<string, string> = {};
  let field: string | undefined;
  let block: string | undefined;
  for (const line of match![1]!.split("\n")) {
    const pair = line.match(/^([a-z-]+):(?: (.*))?$/);
    if (pair) {
      field = pair[1]!;
      expect(Object.hasOwn(frontmatter, field), "duplicate metadata field").toBe(false);
      // xAI's Grok Build catalog drops plain multi-line values; only `>-` blocks may continue.
      expect(pair[2], `${field} needs an inline value or a >- block`).toMatch(/\S/);
      block = pair[2] === ">-" ? field : undefined;
      frontmatter[field] = block ? "" : pair[2]!;
    } else {
      expect(field !== undefined && /^ {2}\S/.test(line), "folded block continuation").toBe(true);
      expect(block, "continuation outside a >- block").toBe(field);
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
  it("the installable folder contains only the declared plugin payload", () => {
    expect(existsSync(pluginRoot)).toBe(true);
    expect(packageFiles(pluginRoot).sort()).toEqual(
      [
        ".claude-plugin/icon.png",
        ".claude-plugin/plugin.json",
        ".cursor-plugin/plugin.json",
        ".grok-plugin/plugin.json",
        ".mcp.json",
        "LICENSE",
        "README.md",
        "mcp.json",
        "plugin.json",
        "skills/watchgoose-batch-monitor-scheduled-jobs/SKILL.md",
        "skills/watchgoose-batch-monitor-scheduled-jobs/proposal.md",
        "skills/watchgoose-cron-coverage-audit/SKILL.md",
        "skills/watchgoose-missed-run-triage/SKILL.md",
        "skills/watchgoose-monitor-scheduled-job/SKILL.md",
        "skills/watchgoose-monitor-scheduled-job/contracts.md",
        "skills/watchgoose-monitor-scheduled-job/instrumentation.md",
        "skills/watchgoose-monitoring-health-review/SKILL.md",
      ].sort()
    );
  });

  it("the migrated package has no second repository-root plugin or skill tree", () => {
    for (const entry of ["skills", ".claude-plugin", "plugin.json", "mcp.json"])
      expect(existsSync(resolve(root, entry)), `legacy duplicate: ${entry}`).toBe(false);
    expect(canonicalSkillFiles(root).sort()).toEqual(
      skillNames.map((name) => resolve(pluginRoot, "skills", name, "SKILL.md")).sort()
    );
  });

  it("the packaged MCP adapter is byte-identical to the contributor config", () => {
    expect(existsSync(resolve(pluginRoot, ".mcp.json"))).toBe(true);
    expect(readFileSync(resolve(pluginRoot, ".mcp.json"), "utf8")).toBe(
      readFileSync(resolve(root, ".mcp.json"), "utf8")
    );
  });

  it("the standalone package includes a license and directory-readable README", () => {
    expect(existsSync(resolve(pluginRoot, "LICENSE"))).toBe(true);
    expect(readFileSync(resolve(pluginRoot, "LICENSE"), "utf8")).toBe(
      readFileSync(resolve(root, "LICENSE"), "utf8")
    );
    const prose = readFileSync(resolve(pluginRoot, "README.md"), "utf8").replace(
      /```[\s\S]*?```/g,
      ""
    );
    expect(prose.trim().split(/\s+/).length).toBeGreaterThanOrEqual(40);
  });

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
    claudeMetadata.parse(pluginJson(".claude-plugin/plugin.json"));
    const loadedNames = readdirSync(resolve(pluginRoot, "skills")).filter((entry) =>
      existsSync(resolve(pluginRoot, "skills", entry, "SKILL.md"))
    );
    expect(loadedNames.sort()).toEqual([...skillNames].sort());
  });

  it("Claude directory metadata rejects insecure URLs and undeclared fields", () => {
    const input = pluginJson(".claude-plugin/plugin.json");
    expect(claudeMetadata.safeParse(input).success).toBe(true);
    const manifest = claudeMetadata.parse(input);
    for (const invalid of [
      { ...manifest, privacyPolicyUrl: "http://watchgoose.com/legal/privacy/" },
      { ...manifest, termsOfServiceUrl: "http://watchgoose.com/legal/terms/" },
      { ...manifest, documentationUrl: "http://watchgoose.com/docs/mcp/" },
      { ...manifest, supportUrl: "mailto:support@watchgoose.com" },
      { ...manifest, icon: "../outside.png" },
      { ...manifest, hooks: {} },
    ]) {
      expect(claudeMetadata.safeParse(invalid).success).toBe(false);
    }
    for (const field of [
      "icon",
      "privacyPolicyUrl",
      "termsOfServiceUrl",
      "displayName",
      "documentationUrl",
      "supportUrl",
    ]) {
      const missing: Record<string, unknown> = { ...manifest };
      delete missing[field];
      expect(claudeMetadata.safeParse(missing).success).toBe(false);
    }
  });

  it("Claude metadata rejects missing or invalid discovery keywords", () => {
    const manifest = claudeMetadata.parse(pluginJson(".claude-plugin/plugin.json"));
    const missing: Record<string, unknown> = { ...manifest };
    delete missing.keywords;
    expect(claudeMetadata.safeParse(missing).success).toBe(false);
    for (const keywords of [[], [""], [" "], [null], [1], "cron"]) {
      expect(claudeMetadata.safeParse({ ...manifest, keywords }).success).toBe(false);
    }
  });

  it("Claude declares the Watchgoose service terms URL", () => {
    const manifest = claudeMetadata.parse(pluginJson(".claude-plugin/plugin.json"));
    expect(manifest.termsOfServiceUrl).toBe("https://watchgoose.com/legal/terms/");
  });

  it("Claude declares the Watchgoose listing documentation and support links", () => {
    const manifest = claudeMetadata.parse(pluginJson(".claude-plugin/plugin.json"));
    expect(manifest.documentationUrl).toBe("https://watchgoose.com/docs/mcp/");
    expect(manifest.supportUrl).toBe("https://watchgoose.com/about/#about-faq-title");
  });

  it("Claude's declared listing icon is bundled as a 512 by 512 PNG", () => {
    const manifest = claudeMetadata.parse(pluginJson(".claude-plugin/plugin.json"));
    const path = resolve(pluginRoot, manifest.icon);
    expect(existsSync(path)).toBe(true);
    const png = readFileSync(path);
    expect(png.length).toBeGreaterThan(33);
    expect(png.length).toBeLessThan(2 * 1024 * 1024);
    expect(png.subarray(0, 8)).toEqual(Buffer.from("89504e470d0a1a0a", "hex"));
    expect(png.readUInt32BE(8)).toBe(13);
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(512);
    expect(png.readUInt32BE(20)).toBe(512);
    expect(png.subarray(-12)).toEqual(Buffer.from("0000000049454e44ae426082", "hex"));
  });

  it("portable metadata contains only supported identity fields and no auto-execution", () => {
    const portable = z
      .object({
        $schema: z.literal("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"),
        ...metadata,
      })
      .strict()
      .parse(pluginJson("plugin.json"));
    const claude = claudeMetadata.parse(pluginJson(".claude-plugin/plugin.json"));
    expect(portable.name).toBe(claude.name);
    expect(portable.version).toBe(claude.version);
    expect(portable.description).toBe(claude.description);
    expect(portable.keywords).toEqual(claude.keywords);
    expect(existsSync(resolve(pluginRoot, "hooks"))).toBe(false);
    expect(existsSync(resolve(pluginRoot, ".app.json"))).toBe(false);
  });

  it("Cursor metadata shares the canonical identity and the packaged hosted MCP config", () => {
    const cursor = z
      .object({
        ...metadata,
        displayName: z.literal("Watchgoose Monitoring"),
        author: z.object({ name: z.string().min(1), email: z.email() }).strict(),
        logo: z.literal(".claude-plugin/icon.png"),
        mcpServers: z.literal("./.mcp.json"),
      })
      .strict()
      .parse(pluginJson(".cursor-plugin/plugin.json"));
    const claude = claudeMetadata.parse(pluginJson(".claude-plugin/plugin.json"));
    expect(cursor.name).toBe(claude.name);
    expect(cursor.version).toBe(claude.version);
    expect(cursor.description).toBe(claude.description);
    expect(cursor.keywords).toEqual(claude.keywords);
    expect(cursor.author.name).toBe(claude.author.name);
    expect(existsSync(resolve(pluginRoot, cursor.logo))).toBe(true);
  });

  it("the Cursor repository marketplace points only at the migrated package", () => {
    const marketplace = z
      .object({
        name,
        owner: z.object({ name: z.string().min(1), email: z.email() }).strict(),
        metadata: z.object({ description: z.string().min(1) }).strict(),
        plugins: z
          .array(z.object({ name, source: z.string(), description: z.string().min(1) }).strict())
          .length(1),
      })
      .strict()
      .parse(json(resolve(root, ".cursor-plugin", "marketplace.json")));
    const claude = claudeMetadata.parse(pluginJson(".claude-plugin/plugin.json"));
    expect(marketplace.plugins[0]).toEqual({
      name: claude.name,
      source: "plugins/watchgoose-monitoring",
      description: claude.description,
    });
  });

  it("Grok metadata shares the canonical identity and uses the default MCP config", () => {
    const grok = z.object(metadata).strict().parse(pluginJson(".grok-plugin/plugin.json"));
    const claude = claudeMetadata.parse(pluginJson(".claude-plugin/plugin.json"));
    expect(grok).toEqual({
      name: claude.name,
      version: claude.version,
      description: claude.description,
      author: claude.author,
      homepage: claude.homepage,
      repository: claude.repository,
      license: claude.license,
      keywords: claude.keywords,
    });
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
    const guide = readFileSync(
      resolve(pluginRoot, "skills/watchgoose-monitor-scheduled-job/contracts.md"),
      "utf8"
    );
    const examples = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)];
    expect(examples).toHaveLength(2);
    for (const example of examples) {
      const input: unknown = JSON.parse(example[1]!);
      expect(createCheckInputSchema.safeParse(input).success).toBe(true);
    }
  });

  it("the batch proposal example supplies only valid plain-new creation inputs", () => {
    const guide = readFileSync(
      resolve(pluginRoot, "skills/watchgoose-batch-monitor-scheduled-jobs/proposal.md"),
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
      .parse(pluginJson(".mcp.json"));
    const portable = z
      .object({
        $schema: z.literal("https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"),
        mcpServers: z
          .object({ watchgoose: z.object({ type: z.literal("streamable-http"), url }).strict() })
          .strict(),
      })
      .strict()
      .parse(pluginJson("mcp.json"));
    expect(portable.mcpServers.watchgoose.url).toBe(claude.mcpServers.watchgoose.url);
  });
});
