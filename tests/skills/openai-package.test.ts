import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import * as z from "zod/v4";
import { buildOpenAiPlugin, stageOpenAiPlugin } from "../../scripts/build-openai-plugin.js";

const root = process.cwd();
const pluginRoot = resolve(root, "plugins", "watchgoose-monitoring");
const outDir = mkdtempSync(join(tmpdir(), "watchgoose-openai-"));

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== ".DS_Store")
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

const canonicalSkills = files(resolve(pluginRoot, "skills")).map((path) => join("skills", path));
const expectedInventory = [
  "LICENSE",
  "assets/icon.png",
  "mcp.json",
  "plugin.json",
  ...canonicalSkills,
].sort();
const canonicalSources: Record<string, string> = {
  LICENSE: resolve(root, "LICENSE"),
  "assets/icon.png": resolve(pluginRoot, ".claude-plugin", "icon.png"),
  "mcp.json": resolve(root, "distribution", "openai", "mcp.json"),
  "plugin.json": resolve(root, "distribution", "openai", "plugin.json"),
  ...Object.fromEntries(canonicalSkills.map((path) => [path, resolve(pluginRoot, path)])),
};

const https = z.url({ protocol: /^https$/ }).max(1024);
const asset = z.literal("./assets/icon.png");
const interfaceSchema = z
  .object({
    displayName: z.string().min(1).max(30),
    shortDescription: z.string().min(1).max(30),
    longDescription: z.string().min(1).max(4000),
    developerName: z.string().min(1).max(80),
    category: z.string().min(1),
    capabilities: z.array(z.string().max(120)).max(20),
    websiteURL: https,
    supportURL: https,
    privacyPolicyURL: https,
    termsOfServiceURL: https,
    defaultPrompt: z
      .array(
        z
          .string()
          .min(1)
          .max(128)
          .refine((prompt) => !prompt.includes("@"))
      )
      .max(3)
      .refine((prompts) => new Set(prompts).size === prompts.length),
    composerIcon: asset,
    logo: asset,
  })
  .strict();
const manifestSchema = z
  .object({
    $schema: z.literal("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"),
    name: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(64),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    description: z.string().min(1),
    author: z.object({ name: z.string().min(1), url: https }).strict(),
    homepage: https,
    repository: https,
    license: z.literal("MIT"),
    keywords: z.array(z.string().min(1)).min(1),
    extensions: z
      .object({
        "com.openai": z
          .object({
            interface: interfaceSchema,
            publication: z.object({ release_notes: z.string().min(1) }).strict(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
const mcpSchema = z
  .object({
    $schema: z.literal("https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"),
    mcpServers: z
      .object({
        watchgoose: z
          .object({
            type: z.literal("streamable-http"),
            url: z.literal("https://mcp.watchgoose.com/mcp"),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

describe("OpenAI plugin package", () => {
  const manifest = manifestSchema.parse(json("distribution/openai/plugin.json"));
  const listing = manifest.extensions["com.openai"].interface;

  it("pins the existing listing identity and approved listing fields", () => {
    expect(manifest.name).toBe("app-6a95a3bd1df8819197ab3ccbf9269e8d");
    expect(listing).toMatchObject({
      displayName: "Watchgoose",
      shortDescription: "Cron job monitoring & alerts",
      developerName: "Pixeware LTD",
      category: "Developer Tools",
      capabilities: [],
      websiteURL: "https://watchgoose.com",
      supportURL: "https://watchgoose.com/docs/",
      privacyPolicyURL: "https://watchgoose.com/legal/privacy/",
      termsOfServiceURL: "https://watchgoose.com/legal/terms/",
    });
    expect(listing.longDescription).toMatch(
      /^Watchgoose is cron job and heartbeat monitoring for scheduled tasks/
    );
  });

  it("keeps listing copy free of promotions that OpenAI's plugin policy prohibits", () => {
    const copy = [
      listing.displayName,
      listing.shortDescription,
      listing.longDescription,
      ...listing.defaultPrompt,
      manifest.extensions["com.openai"].publication.release_notes,
    ].join("\n");
    expect(copy).not.toMatch(/\b(free|trial|discount|coupon|upgrade|pricing|subscribe)\b/i);
  });

  it("shares the canonical description and keywords with the portable plugin", () => {
    const portable = json(resolve(pluginRoot, "plugin.json"));
    expect(manifest.description).toBe(portable.description);
    expect(manifest.keywords).toEqual(portable.keywords);
  });

  it("reuses the existing hosted MCP connection without an auth override", () => {
    const mcp = mcpSchema.parse(json("distribution/openai/mcp.json"));
    const claude = json(resolve(pluginRoot, ".mcp.json")) as {
      mcpServers: Record<string, { url: string }>;
    };
    expect(mcp.mcpServers.watchgoose.url).toBe(claude.mcpServers.watchgoose?.url);
  });

  it("stages the canonical skills, icon and manifests without rejected components", () => {
    const stage = stageOpenAiPlugin(outDir);
    const staged = files(stage);
    expect(staged).toEqual(expectedInventory);
    for (const path of staged) {
      expect(readFileSync(join(stage, path)), path).toEqual(readFileSync(canonicalSources[path]!));
    }
    const text = staged
      .filter((path) => path.endsWith(".json") || path.endsWith(".md"))
      .map((path) => readFileSync(join(stage, path), "utf8"))
      .join("\n");
    for (const forbidden of [
      "clientSecret",
      "test_credentials",
      "reviewer_instructions",
      '"apps"',
      '"hooks"',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    const png = readFileSync(join(stage, "assets", "icon.png"));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(png.readUInt32BE(20));
    expect(statSync(join(stage, "assets", "icon.png")).size).toBeLessThan(5 * 1024 * 1024);
  });

  it("builds a ZIP with the plugin files at the archive root", () => {
    const zip = buildOpenAiPlugin(outDir);
    expect(zip.endsWith(`watchgoose-openai-${manifest.version}.zip`)).toBe(true);
    const archived = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" })
      .split("\n")
      .filter((path) => path !== "" && !path.endsWith("/"))
      .sort();
    expect(archived).toEqual(expectedInventory);
    expect(canonicalSkills.filter((path) => path.endsWith("/SKILL.md"))).toHaveLength(5);
    for (const path of archived) {
      expect(execFileSync("unzip", ["-p", zip, path]), path).toEqual(
        readFileSync(canonicalSources[path]!)
      );
    }
  });
});
