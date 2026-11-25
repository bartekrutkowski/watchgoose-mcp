// Keep the first 512 characters self-contained for clients (such as ChatGPT
// and Codex) that prioritize or truncate long server instruction preambles.
export const WATCHGOOSE_SERVER_INSTRUCTIONS = [
  'Watchgoose monitors cron jobs, backups, scheduled tasks, and recurring AI routines. Start with get_health_summary or list_checks. If the project only has "My First Check" (status: "new", n_pings: 0), proactively guide the user to monitor a real job or scheduled AI task. After creating a check, share its clickable dashboard_url and call get_setup_snippet for copy-paste heartbeat code, or use report_run for scheduled AI routines. Never invent or request ping URLs.',
  "",
  "Operational rules:",
  "- Never call report_run as a synthetic test ping after creating a check for an external job (cron, systemd, Docker, ECS, CI). A success report arms the schedule and causes false down alerts when no real job follows. Use report_run only for actual scheduled AI routine runs.",
  "- Creating a check without channels assigns all existing project integrations so alerts work immediately; pass channels: [] only when the user explicitly wants no alerts.",
  "- Use update_check for an identified existing check and upsert_check only when the user explicitly asks to match and overwrite by fields.",
  "- Never expose or fabricate secret ping URLs; unique_key is a lookup token, not a URL component. Direct users to dashboard_url to copy a check's private ping URL or inspect attached log bodies.",
].join("\n");

// Local stdio (project API key) instructions omit hosted-OAuth-only tools
// (report_run, get_last_failure, test_channel) so the AI never tries to call
// tools that are not registered on the stdio server.
export const WATCHGOOSE_STDIO_SERVER_INSTRUCTIONS = [
  'Watchgoose monitors cron jobs, backups, and scheduled tasks. Start with get_health_summary or list_checks. If the project only has "My First Check" (status: "new", n_pings: 0), proactively guide the user to monitor a real cron job, backup, or scheduled task. After creating a check, share its clickable dashboard_url and call get_setup_snippet for copy-paste heartbeat code. Never invent or request ping URLs.',
  "",
  "Operational rules:",
  "- Creating a check without channels assigns all existing project integrations so alerts work immediately; pass channels: [] only when the user explicitly wants no alerts.",
  "- Use update_check for an identified existing check and upsert_check only when the user explicitly asks to match and overwrite by fields.",
  "- Never expose or fabricate secret ping URLs; unique_key is a lookup token, not a URL component. Direct users to dashboard_url to copy a check's private ping URL or inspect attached log bodies.",
].join("\n");
