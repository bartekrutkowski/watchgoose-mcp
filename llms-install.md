# Installing Watchgoose MCP

Watchgoose MCP connects an AI client to one Watchgoose project so it can inspect cron and
recurring-task monitoring. Use the hosted endpoint below. You don't need to clone or build this
repository.

## Option 1 (recommended): hosted server with OAuth, no API key

1. Open `cline_mcp_settings.json` (**MCP Servers > Configure MCP Servers**).
2. Add this entry inside `mcpServers`, keeping any existing servers:

```json
{
  "mcpServers": {
    "watchgoose": {
      "type": "streamableHttp",
      "url": "https://mcp.watchgoose.com/mcp"
    }
  }
}
```

3. Keep `"type": "streamableHttp"` exactly as written. Without it Cline falls back to SSE and the
   connection fails.
4. Save the file. When Cline asks to authenticate, the user signs in to Watchgoose in the browser,
   chooses one project and approves access. Read-only access is selected by default; keep it unless
   the user wants Cline to change checks.
5. Confirm the connection by calling `list_checks`.

Don't ask the user for an API key for this option. Authentication is OAuth 2.1 with PKCE S256 and
Dynamic Client Registration.

## Option 2: local npm package with a project API key

Use this only if the user prefers an API key. It requires Node.js 20 or later.

1. Tell the user to create a project-scoped Watchgoose API key in **Project settings > API Access**,
   but not to paste it into the chat. An `hcr_` key is read-only; an `hcw_` key is read-write.
   Recommend `hcr_` unless they need pings, integrations or check changes.
2. Add this entry to `cline_mcp_settings.json` with the placeholder unchanged, then ask the user to
   open the file and replace `hcr_your_project_key` with their key themselves:

```json
{
  "mcpServers": {
    "watchgoose": {
      "command": "npx",
      "args": ["-y", "watchgoose-mcp"],
      "env": {
        "WATCHGOOSE_API_KEY": "hcr_your_project_key"
      }
    }
  }
}
```

3. Writes stay disabled by default, even with an `hcw_` key. To expose the create, update, pause,
   resume and delete tools, the user also sets `"WATCHGOOSE_ENABLE_WRITES": "true"` in `env` and
   uses an `hcw_` key.
4. Confirm the connection by calling `list_checks`.

Never ask for, read back or repeat the API key. If the user pastes one into the chat anyway, tell
them to revoke it in **Project settings > API Access** and create a new one.

## Tools

Read-only: `list_checks`, `get_check`, `list_flips`. Read-write: `list_pings`, `list_channels`, and,
when writes are enabled, `create_check`, `update_check`, `pause_check`, `resume_check` and
`delete_check`.

Docs: https://watchgoose.com/docs/mcp/ · Support: support@watchgoose.com
