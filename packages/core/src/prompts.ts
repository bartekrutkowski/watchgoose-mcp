import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AccessLevel } from "./constants.js";

export interface WatchgoosePromptsOptions {
  access: AccessLevel;
  enableWrites?: boolean;
  enableMcpEndpoints?: boolean;
}

export const PROMPT_NAMES = [
  "setup_first_monitor",
  "monitor_scheduled_agent",
  "audit_cron_jobs",
  "monitoring_health_review",
] as const;

export function registerWatchgoosePrompts(
  server: McpServer,
  options: WatchgoosePromptsOptions
): void {
  const canWrite = options.access === "read-write" && Boolean(options.enableWrites);
  const hasMcpEndpoints = Boolean(options.enableMcpEndpoints);

  server.registerPrompt(
    "setup_first_monitor",
    {
      title: "Set up your first Watchgoose monitor",
      description:
        "Guide the user through creating a check for a real cron job, backup, or scheduled task and generating copy-paste heartbeat instrumentation.",
      argsSchema: {
        job_description: z
          .string()
          .max(500)
          .optional()
          .describe(
            "Optional description of the scheduled job to monitor (e.g. nightly Postgres backup)."
          ),
        platform: z
          .string()
          .max(60)
          .optional()
          .describe(
            "Optional runtime platform (cron, systemd, docker, aws-ecs, github-actions, python, rclone, claude-routine, cursor-automation, codex-automation)."
          ),
      },
    },
    ({ job_description, platform }) => {
      const jobHint = job_description ? `The user wants to monitor: ${job_description}.` : "";
      const platformHint = platform ? `Target platform: ${platform}.` : "";
      const writeStep = canWrite
        ? "After confirming schedule/interval, timezone, and grace period with the user, call create_check (omitting channels assigns all project alert integrations automatically), share the returned dashboard_url, and call get_setup_snippet to provide ready-to-paste heartbeat code."
        : "This connection is read-only, so draft the exact check settings and tell the user how to reconnect with Read and write access if they want you to create it automatically.";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Help me set up monitoring in Watchgoose.",
                jobHint,
                platformHint,
                "1. Call get_health_summary first to see existing checks and whether this project still only has the default My First Check.",
                "2. Ask only the missing questions needed to configure a check accurately (what the job does, schedule or interval, timezone, and grace period).",
                `3. ${writeStep}`,
                hasMcpEndpoints
                  ? "4. Remind me that schedule monitoring arms after the first real successful ping (never invent a ping URL and never send a synthetic test ping via report_run for an external job)."
                  : "4. Remind me that schedule monitoring arms after the first real successful ping (never invent or ask for a ping URL).",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          },
        ],
      };
    }
  );

  if (hasMcpEndpoints) {
    server.registerPrompt(
      "monitor_scheduled_agent",
      {
        title: "Monitor a scheduled AI routine",
        description:
          "Create a Watchgoose monitor for a recurring AI agent routine (Claude Routine, Cursor Automation, or Codex Automation) using MCP report_run.",
        argsSchema: {
          routine_name: z
            .string()
            .max(120)
            .optional()
            .describe("Name of the scheduled AI routine (e.g. Daily PR triage)."),
          schedule: z
            .string()
            .max(100)
            .optional()
            .describe("Cron expression or cadence for the routine (e.g. 0 9 * * 1-5)."),
        },
      },
      ({ routine_name, schedule }) => {
        const details = [
          routine_name ? `Routine name: ${routine_name}.` : "",
          schedule ? `Schedule: ${schedule}.` : "",
        ]
          .filter(Boolean)
          .join(" ");

        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: [
                  "Set up Watchgoose monitoring for a scheduled AI routine so I get alerted if it misses a run, hangs, or fails.",
                  details,
                  canWrite
                    ? "1. Confirm the routine name, schedule/interval, timezone, and grace period, then call create_check."
                    : "1. This connection is read-only; draft the recommended check settings and explain that Read and write access is required for create_check and report_run.",
                  "2. Call get_setup_snippet with platform claude-routine, cursor-automation, or codex-automation to produce the exact report_run instructions to paste into the routine prompt.",
                  "3. Share the clickable dashboard_url so I can inspect run history and alert channels.",
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            },
          ],
        };
      }
    );
  }

  server.registerPrompt(
    "audit_cron_jobs",
    {
      title: "Audit repository cron coverage",
      description:
        "Compare scheduled jobs in the current codebase against existing Watchgoose checks without mutating anything.",
      argsSchema: {
        path: z
          .string()
          .max(300)
          .optional()
          .describe(
            "Optional directory or file path containing schedules (e.g. ops/, .github/workflows/)."
          ),
      },
    },
    ({ path }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Perform a read-only Watchgoose monitoring coverage audit.",
              path
                ? `Focus on: ${path}.`
                : "Inspect scheduled jobs, crontabs, systemd timers, and CI schedules in the workspace.",
              "1. Call get_health_summary and list_checks to see what is currently monitored in this Watchgoose project.",
              "2. Compare observed jobs against existing checks, clearly distinguishing confirmed coverage, confirmed gaps, and unknowns.",
              "3. Do not create checks, edit files, or execute jobs during the audit.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "monitoring_health_review",
    {
      title: "Review Watchgoose monitoring health",
      description:
        "Summarize down, late, unarmed, paused, and unrouted checks in the connected project and diagnose any recent failures.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Review my Watchgoose project's monitoring health without making changes.",
              "1. Call get_health_summary to get counts and lists of down, grace/late, unarmed (new), paused, and unrouted checks.",
              options.access === "read-write" && hasMcpEndpoints
                ? "2. For any down check, call get_last_failure or list_flips to inspect failure reason, downtime duration, and exit status; if a log body is attached, direct the user to dashboard_url to read it."
                : "2. For any down check, call list_flips to inspect recent status transitions.",
              "3. Present prioritized findings with clickable dashboard_url links and concrete next steps.",
            ].join("\n"),
          },
        },
      ],
    })
  );
}
