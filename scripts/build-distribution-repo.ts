// Stages the contents of the marketplace distribution repository from the canonical package in
// plugins/watchgoose-monitoring. The package becomes the repository root, so Cursor and Grok Build
// find their manifests without a subdirectory path. Run with Node 24 or later.
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const DISTRIBUTION_REPOSITORY = "https://github.com/pixeware/watchgoose-plugin";

const MANIFESTS = [
  ".claude-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  ".grok-plugin/plugin.json",
  "plugin.json",
];

export function stageDistributionRepo(outDir: string, root = repoRoot): string {
  const stage = join(outDir, "watchgoose-plugin");
  rmSync(stage, { recursive: true, force: true });
  cpSync(join(root, "plugins", "watchgoose-monitoring"), stage, {
    recursive: true,
    filter: (source) => basename(source) !== ".DS_Store",
  });
  for (const manifest of MANIFESTS) {
    const path = join(stage, manifest);
    const json = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    json.repository = DISTRIBUTION_REPOSITORY;
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  }
  return stage;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(stageDistributionRepo(join(repoRoot, "dist", "distribution")));
}
