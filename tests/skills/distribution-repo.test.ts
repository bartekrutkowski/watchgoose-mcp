import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DISTRIBUTION_REPOSITORY,
  stageDistributionRepo,
} from "../../scripts/build-distribution-repo.js";

const pluginRoot = resolve(process.cwd(), "plugins", "watchgoose-monitoring");
const outDir = mkdtempSync(join(tmpdir(), "watchgoose-distribution-"));
const manifests = [
  ".claude-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  ".grok-plugin/plugin.json",
  "plugin.json",
];

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== ".DS_Store")
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("marketplace distribution repository", () => {
  const stage = stageDistributionRepo(outDir);

  it("places the canonical package at the repository root", () => {
    expect(files(stage)).toEqual(files(pluginRoot));
  });

  it("copies every non-manifest file byte for byte", () => {
    for (const path of files(pluginRoot).filter((path) => !manifests.includes(path))) {
      expect(readFileSync(join(stage, path)), path).toEqual(readFileSync(join(pluginRoot, path)));
    }
  });

  it("points every manifest at the distribution repository and changes nothing else", () => {
    expect(DISTRIBUTION_REPOSITORY).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
    for (const path of manifests) {
      const staged = json(join(stage, path));
      expect(staged.repository, path).toBe(DISTRIBUTION_REPOSITORY);
      expect({ ...staged, repository: undefined }, path).toEqual({
        ...json(join(pluginRoot, path)),
        repository: undefined,
      });
    }
  });

  it("publishes from release tags to the same repository the manifests name", () => {
    const workflow = readFileSync(".github/workflows/distribution.yml", "utf8");
    const target = new URL(DISTRIBUTION_REPOSITORY).pathname.slice(1);
    expect(workflow).toContain(`repository: ${target}\n`);
    expect(workflow).toContain('tags: ["v*"]');
    expect(workflow).toContain("npm run build:distribution-repo");
    expect(workflow).not.toMatch(/--force|\+refs|push -f/);
    // An empty secret silently falls back to a read-only HTTPS checkout; fail before that.
    expect(workflow).toContain('if [ -z "$DEPLOY_KEY" ]; then');
    expect(workflow.match(/uses: actions\/checkout@/g)).toHaveLength(2);
    expect(workflow).toMatch(
      /uses: actions\/checkout@v\d+\n\s+with:\n\s+persist-credentials: false\n/
    );
  });
});
