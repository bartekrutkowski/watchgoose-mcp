// Builds the OpenAI plugin ZIP for the existing ChatGPT/Codex listing from the
// canonical skills in plugins/watchgoose-monitoring. Run with Node 24 or later.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function stageOpenAiPlugin(outDir: string, root = repoRoot): string {
  const stage = join(outDir, "watchgoose-openai");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, "assets"), { recursive: true });
  cpSync(join(root, "distribution", "openai", "plugin.json"), join(stage, "plugin.json"));
  cpSync(join(root, "distribution", "openai", "mcp.json"), join(stage, "mcp.json"));
  cpSync(join(root, "plugins", "watchgoose-monitoring", "skills"), join(stage, "skills"), {
    recursive: true,
    filter: (source) => basename(source) !== ".DS_Store",
  });
  const icon = join(root, "plugins", "watchgoose-monitoring", ".claude-plugin", "icon.png");
  cpSync(icon, join(stage, "assets", "icon.png"));
  // OpenAI-only skill metadata (agents/openai.yaml) and the icon it references, so ChatGPT
  // shows the Watchgoose icon instead of picking one for each skill.
  for (const skill of readdirSync(join(root, "distribution", "openai", "skills"))) {
    if (skill === ".DS_Store") continue;
    const target = join(stage, "skills", skill);
    if (!existsSync(join(target, "SKILL.md"))) throw new Error(`Unknown skill: ${skill}`);
    cpSync(join(root, "distribution", "openai", "skills", skill), target, {
      recursive: true,
      filter: (source) => basename(source) !== ".DS_Store",
    });
    mkdirSync(join(target, "assets"), { recursive: true });
    cpSync(icon, join(target, "assets", "icon.png"));
  }
  cpSync(join(root, "LICENSE"), join(stage, "LICENSE"));
  return stage;
}

export function buildOpenAiPlugin(outDir: string, root = repoRoot): string {
  const stage = stageOpenAiPlugin(outDir, root);
  const { version } = JSON.parse(readFileSync(join(stage, "plugin.json"), "utf8")) as {
    version: string;
  };
  const zip = resolve(outDir, `watchgoose-openai-${version}.zip`);
  rmSync(zip, { force: true });
  execFileSync("zip", ["-X", "-r", "-q", zip, "."], { cwd: stage });
  return zip;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(buildOpenAiPlugin(join(repoRoot, "dist", "openai")));
}
