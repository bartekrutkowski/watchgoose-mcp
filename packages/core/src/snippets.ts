export const SETUP_SNIPPET_PLATFORMS = [
  "cron",
  "systemd",
  "docker",
  "aws-ecs",
  "github-actions",
  "python",
  "rclone",
  "claude-routine",
  "cursor-automation",
  "codex-automation",
] as const;

export type SetupSnippetPlatform = (typeof SETUP_SNIPPET_PLATFORMS)[number];

const PLATFORM_LABELS: Readonly<Record<SetupSnippetPlatform, string>> = {
  cron: "cron",
  systemd: "systemd",
  docker: "Docker",
  "aws-ecs": "AWS ECS",
  "github-actions": "GitHub Actions",
  python: "Python",
  rclone: "rclone",
  "claude-routine": "Claude Routine",
  "cursor-automation": "Cursor Automation",
  "codex-automation": "Codex Automation",
};

export interface SetupSnippetInput {
  platform: SetupSnippetPlatform;
  uniqueKey: string;
  name?: string | undefined;
  slug?: string | undefined;
  dashboardUrl: string;
  includeStart?: boolean | undefined;
}

export interface SetupSnippetResult {
  platform: SetupSnippetPlatform;
  unique_key: string;
  dashboard_url: string;
  env_var: string;
  uses_mcp_report_run: boolean;
  snippet: string;
  instructions: string;
}

function envVarName(slug?: string): string {
  const normalized = (slug ?? "job")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `WATCHGOOSE_PING_URL_${normalized || "JOB"}`;
}

export function buildSetupSnippet(input: SetupSnippetInput): SetupSnippetResult {
  const includeStart = input.includeStart ?? true;
  const envVar = envVarName(input.slug);
  const label = input.name || input.slug || "your check";

  if (
    input.platform === "claude-routine" ||
    input.platform === "cursor-automation" ||
    input.platform === "codex-automation"
  ) {
    const startLine = includeStart
      ? `- At the very beginning of the run, call the Watchgoose MCP tool report_run with { "unique_key": "${input.uniqueKey}", "status": "start" }.\n`
      : "";
    const snippet = [
      "## Watchgoose run reporting",
      `${startLine}- After completing the main task successfully, call report_run with { "unique_key": "${input.uniqueKey}", "status": "success", "summary": "<short one-line outcome>" }.`,
      `- If the task encounters an unrecoverable error, call report_run with { "unique_key": "${input.uniqueKey}", "status": "fail", "summary": "<short error summary>" }.`,
    ].join("\n");

    return {
      platform: input.platform,
      unique_key: input.uniqueKey,
      dashboard_url: input.dashboardUrl,
      env_var: "MCP_TOOL_REPORT_RUN",
      uses_mcp_report_run: true,
      snippet,
      instructions: `Paste these instructions into your ${PLATFORM_LABELS[input.platform]} prompt. No secret ping URL is needed—the routine reports directly through the hosted Watchgoose OAuth connector (https://mcp.watchgoose.com/mcp, Read and write access; not available on local API-key stdio connections). View status and alerts at ${input.dashboardUrl}.`,
    };
  }

  let snippet: string;
  const startCurl = includeStart
    ? `curl -fsS -m 10 --retry 5 "\${${envVar}}/start" >/dev/null || true\n`
    : "";

  switch (input.platform) {
    case "cron":
      snippet = [
        "#!/usr/bin/env bash",
        "set -uo pipefail",
        `: "\${${envVar}:?Set ${envVar} in your environment or secret store}"`,
        startCurl.trimEnd(),
        "# Replace with your real job command:",
        "your-job-command",
        "rc=$?",
        `curl -fsS -m 10 --retry 5 "\${${envVar}}/\${rc}" >/dev/null || true`,
        'exit "$rc"',
      ]
        .filter(Boolean)
        .join("\n");
      break;

    case "systemd":
      snippet = [
        "[Service]",
        "Type=oneshot",
        `EnvironmentFile=/etc/watchgoose/${input.slug || "job"}.env`,
        ...(includeStart
          ? [`ExecStartPre=-/usr/bin/curl -fsS -m 10 --retry 5 \${${envVar}}/start`]
          : []),
        "ExecStart=/usr/local/bin/your-job-command",
        `ExecStartPost=/usr/bin/curl -fsS -m 10 --retry 5 \${${envVar}}`,
        `ExecStopPost=/bin/sh -c 'if [ "$SERVICE_RESULT" != "success" ]; then curl -fsS -m 10 --retry 5 "\${${envVar}}/fail"; fi'`,
      ].join("\n");
      break;

    case "docker":
      snippet = [
        "#!/bin/sh",
        "set -u",
        `: "\${${envVar}:?Set ${envVar} as a container secret/env var}"`,
        ...(includeStart
          ? [`curl -fsS -m 10 --retry 5 "\${${envVar}}/start" >/dev/null || true`]
          : []),
        'your-job-command "$@"',
        "rc=$?",
        `curl -fsS -m 10 --retry 5 "\${${envVar}}/\${rc}" >/dev/null || true`,
        'exit "$rc"',
      ].join("\n");
      break;

    case "aws-ecs":
      snippet = [
        "#!/bin/sh",
        "set -u",
        `# Inject ${envVar} via ECS taskDefinition.containerDefinitions[].secrets (Secrets Manager / SSM)`,
        `: "\${${envVar}:?Set ${envVar} in ECS task secrets}"`,
        ...(includeStart
          ? [`curl -fsS -m 10 --retry 5 "\${${envVar}}/start" >/dev/null || true`]
          : []),
        "your-ecs-worker-command",
        "rc=$?",
        `curl -fsS -m 10 --retry 5 "\${${envVar}}/\${rc}" >/dev/null || true`,
        'exit "$rc"',
      ].join("\n");
      break;

    case "github-actions":
      snippet = [
        "      - name: Run job with Watchgoose heartbeat",
        "        env:",
        `          ${envVar}: \${{ secrets.${envVar} }}`,
        "        run: |",
        "          set +e",
        ...(includeStart
          ? [`          curl -fsS -m 10 --retry 5 "\${${envVar}}/start" >/dev/null || true`]
          : []),
        "          your-job-command",
        "          rc=$?",
        `          curl -fsS -m 10 --retry 5 "\${${envVar}}/\${rc}" >/dev/null || true`,
        '          exit "$rc"',
      ].join("\n");
      break;

    case "python":
      snippet = [
        "import os, sys, urllib.request",
        "",
        `PING_URL = os.environ["${envVar}"].rstrip("/")`,
        "",
        'def ping(suffix: str = "") -> None:',
        "    try:",
        '        urllib.request.urlopen(f"{PING_URL}{suffix}", timeout=10).read()',
        "    except Exception:",
        "        pass",
        "",
        "def main() -> int:",
        ...(includeStart ? ['    ping("/start")'] : []),
        "    try:",
        "        # Replace with your job logic:",
        "        run_job()",
        "    except Exception:",
        '        ping("/fail")',
        "        raise",
        "    ping()",
        "    return 0",
        "",
        'if __name__ == "__main__":',
        "    sys.exit(main())",
      ].join("\n");
      break;

    case "rclone":
      snippet = [
        "#!/usr/bin/env bash",
        "set -uo pipefail",
        `: "\${${envVar}:?Set ${envVar} in your environment or secret store}"`,
        ...(includeStart
          ? [`curl -fsS -m 10 --retry 5 "\${${envVar}}/start" >/dev/null || true`]
          : []),
        "output=$(rclone sync /path/to/source remote:bucket/backup 2>&1)",
        "rc=$?",
        `printf '%s' "$output" | tail -c 4000 | curl -fsS -m 10 --retry 5 --data-binary @- "\${${envVar}}/\${rc}" >/dev/null || true`,
        'exit "$rc"',
      ].join("\n");
      break;
  }

  return {
    platform: input.platform,
    unique_key: input.uniqueKey,
    dashboard_url: input.dashboardUrl,
    env_var: envVar,
    uses_mcp_report_run: false,
    snippet,
    instructions: `1. Open ${label} in Watchgoose: ${input.dashboardUrl}\n2. Copy its private Ping URL into the ${envVar} environment variable or secret store (never commit it to source code or paste it in chat).\n3. Run the job once; schedule monitoring arms after the first successful ping.`,
  };
}
