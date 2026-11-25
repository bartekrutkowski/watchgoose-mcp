# Watchgoose MCP

Watchgoose MCP connects MCP-capable AI clients to the Watchgoose Management API. It lets you inspect
cron and recurring-task monitoring, with check changes available only when you explicitly enable
writes.

## Hosted connector

Use the hosted Streamable HTTP endpoint in clients that support OAuth 2.1 and Dynamic Client
Registration:

```text
https://mcp.watchgoose.com/mcp
```

### Available in

Watchgoose is [available in the Claude connector directory](https://claude.ai/directory/watchgoose).

Watchgoose is
[listed in ChatGPT plugins for GPT and Codex](https://chatgpt.com/plugins/plugin_asdk_app_6a95a3bd1df8819197ab3ccbf9269e8d).

Watchgoose is
[listed in the official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.bartekrutkowski/watchgoose-mcp).

The [`watchgoose-mcp` package is available on npm](https://www.npmjs.com/package/watchgoose-mcp).

In Claude, open **Settings > Connectors** and add the endpoint as a custom connector. For Claude
Code, run:

```shell
claude mcp add --transport http --scope user watchgoose https://mcp.watchgoose.com/mcp
```

The browser consent flow limits each connection to one project and defaults to read-only access. See
the [Watchgoose MCP documentation](https://watchgoose.com/docs/mcp/) for the tool and privacy
boundaries.

## Requirements

- Node.js 20 or later
- A project-scoped Watchgoose API key from **Project settings → API Access → Create (read-only)**

Use an `hcr_` read-only key when you only need check state and status history. Use an `hcw_`
read-write key when you also need pings, integrations, or check changes.

## Claude Desktop

Add this entry to `claude_desktop_config.json` and restart Claude Desktop:

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

## Claude Code

```shell
claude mcp add --env WATCHGOOSE_API_KEY=hcr_your_project_key \
  --transport stdio --scope user watchgoose -- npx -y watchgoose-mcp
```

Run `claude mcp get watchgoose` to check the connection.

## Cursor

Create `.cursor/mcp.json` in your project, or add the same entry to your user MCP configuration:

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

## VS Code

Create `.vscode/mcp.json`:

```json
{
  "servers": {
    "watchgoose": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "watchgoose-mcp"],
      "env": {
        "WATCHGOOSE_API_KEY": "hcr_your_project_key"
      }
    }
  }
}
```

Run **MCP: List Servers** and start `watchgoose`.

## Cline

Cline connects to the hosted endpoint with OAuth, so no API key is needed. Open **MCP Servers >
Configure MCP Servers** and add this entry to `cline_mcp_settings.json`:

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

Keep `"type": "streamableHttp"` exactly as written; without it Cline falls back to SSE and the
connection fails. When Cline prompts you to authenticate, sign in to Watchgoose in the browser,
choose one project and keep read-only access unless you want Cline to change checks. To use a
project API key instead, add the `npx` entry from the Cursor section above to the same file.

## Environment

| Variable                    |         Required | Default                         | Description                                                                                                                                  |
| --------------------------- | ---------------: | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `WATCHGOOSE_API_KEY`        |              Yes | -                               | Project-scoped `hcr_` read-only key, `hcw_` read-write key, or legacy 32-character key.                                                      |
| `WATCHGOOSE_API_URL`        |               No | `https://watchgoose.com/api/v3` | Management API base URL. HTTPS is required except for loopback development hosts. The key is sent to this host, so use only a URL you trust. |
| `WATCHGOOSE_ENABLE_WRITES`  |               No | `false`                         | Set to `true` to expose mutation tools when the key is read-write.                                                                           |
| `WATCHGOOSE_API_KEY_ACCESS` | Legacy keys only | -                               | Required as `read-only` or `read-write` for an unprefixed 32-character key.                                                                  |

The server classifies key prefixes locally and never probes the API to infer access. Setting
`WATCHGOOSE_ENABLE_WRITES=true` cannot give a read-only key additional access.

## Tools

Checks are addressed by stable 40-character `unique_key` values and include a clickable
`dashboard_url` (`/cloaked/<unique_key>/`) for opening the check in Watchgoose. UUIDs, ping URLs,
and integration UUIDs are used only inside the server and are not shown to the AI client.

| Tool                 | Required access                         | Management API mapping                                      |
| -------------------- | --------------------------------------- | ----------------------------------------------------------- |
| `list_checks`        | Read-only                               | `GET /checks/`                                              |
| `get_check`          | Read-only                               | `GET /checks/<unique_key>`                                  |
| `list_flips`         | Read-only                               | `GET /checks/<unique_key>/flips/`                           |
| `get_health_summary` | Read-only                               | `GET /checks/` (+ `GET /channels/` when read-write)         |
| `get_setup_snippet`  | Read-only                               | `GET /checks/<unique_key>` (generates local setup template) |
| `list_pings`         | Read-write                              | Resolve `unique_key`, then `GET /checks/<uuid>/pings/`      |
| `list_channels`      | Read-write                              | `GET /channels/`                                            |
| `get_last_failure`   | Read-write (hosted OAuth only)          | `GET /mcp/checks/<unique_key>/last-failure/`                |
| `create_check`       | Read-write plus writes enabled          | `POST /checks/`                                             |
| `upsert_check`       | Read-write plus writes enabled          | `POST /checks/` with `unique`                               |
| `update_check`       | Read-write plus writes enabled          | Resolve `unique_key`, then `POST /checks/<uuid>`            |
| `pause_check`        | Read-write plus writes enabled          | Resolve `unique_key`, then `POST /checks/<uuid>/pause`      |
| `resume_check`       | Read-write plus writes enabled          | Resolve `unique_key`, then `POST /checks/<uuid>/resume`     |
| `delete_check`       | Read-write plus writes enabled          | Resolve `unique_key`, then `DELETE /checks/<uuid>`          |
| `report_run`         | Read-write + writes (hosted OAuth only) | `POST /mcp/checks/<unique_key>/report/`                     |
| `test_channel`       | Read-write + writes (hosted OAuth only) | `POST /mcp/channels/test/`                                  |

The local stdio package (`watchgoose-mcp` on npm) uses project API keys against the standard
Management API v3 and exposes up to 13 tools (5 read-only, 7 read-write, 13 with writes enabled).
The hosted OAuth server (`https://mcp.watchgoose.com/mcp`) additionally exposes `get_last_failure`,
`report_run`, and `test_channel` backed by MCP-token-only audited endpoints.

The server also advertises built-in MCP prompts (`setup_first_monitor`, `audit_cron_jobs`,
`monitoring_health_review`, and on the hosted OAuth server `monitor_scheduled_agent`) plus concise
server instructions tailored to the connected server's available tools.

Integration assignments use exact integration names. Names must be non-empty and unique within the
project.

`create_check` creates a new check (`destructiveHint: false`). When `slug` is omitted and `name` is
provided, a URL-safe slug is generated automatically. When `channels` is omitted, all existing
project alert integrations are assigned automatically (`channels: "*"`); pass `channels: []` to
assign none.

`upsert_check` (`destructiveHint: true`) matches an existing check by the specified `unique` fields
and replaces its supplied settings (or creates a new check if none match). `timeout` without
`schedule` also switches a scheduled check to interval monitoring: the stored schedule string
remains, but no longer governs cadence. Include the confirmed schedule to retain scheduled
monitoring. On a matched check, other omitted settings remain unchanged and `channels: []` clears
all alert integration assignments; when creating a new check, omitting `channels` assigns none.

`report_run` (hosted OAuth only) records a real `start`, `success`, `fail`, or `log` signal for a
check directly through Watchgoose without exposing a ping URL. It is designed for scheduled AI
routines (Claude Routines, Cursor Automations, Codex Automations) and agent workflows. Never call it
as a synthetic test ping for an external cron/CI job.

`test_channel` (hosted OAuth only) sends a rate-limited test alert to a named integration. Metered
SMS, phone call, and WhatsApp integrations (or groups containing them) cannot be tested via MCP and
must be tested from the Watchgoose dashboard.

A new check awaits success/failure for completion-based cadence; a first failure can move it down.
An optional start ping can initiate runtime monitoring before completion.

List results are capped at 100 checks, 100 pings, 200 flips, and 100 integrations. Every serialized
tool result is also capped at 24,000 characters. Results include metadata when entries are omitted.

## Security

- Writes are disabled by default, even with an `hcw_` key.
- The API key is sent only in the `X-Api-Key` header and is never logged or returned.
- API redirects are rejected so credentials cannot be forwarded to another host.
- Check UUIDs, ping and update URLs, integration UUIDs, and unknown future API fields are removed
  from output.
- `list_pings` keeps only `type`, `date`, `n`, `scheme`, `method`, and `duration`. Source IP
  addresses, user agents, run IDs, and body URLs are removed.
- Ping body contents are never sent to the connected AI client. `get_last_failure` returns only
  structured failure metadata (`reason`, `down_duration_seconds`, `exit_status`, `has_body`,
  `body_size_bytes`) and a clickable `dashboard_url`.
- The server has no telemetry.

Protect client configuration files that contain API keys. Prefer a dedicated project and the
least-privileged key that exposes the tools you need. Revoke a key from Watchgoose project settings
when it is no longer in use.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Workflow skills

The repository includes portable skills for auditing scheduled-job coverage, drafting single-job
setup, triaging missed heartbeats, reviewing existing monitoring health, and proposing approved
create-only batches from an audit, list or CSV. See the
[skills guide](https://github.com/bartekrutkowski/watchgoose-mcp/blob/main/docs/skills.md) for local
installation, examples, and safety boundaries. Skills do not grant additional access, automatically
run jobs, or change the existing directory listings.

The installable
[monitoring plugin](https://github.com/bartekrutkowski/watchgoose-mcp/tree/main/plugins/watchgoose-monitoring)
lives in `plugins/watchgoose-monitoring/`, with one canonical skill tree and remote-MCP adapters.
Load that subfolder rather than the repository root; the old root plugin/skill paths are superseded
without automatic migration of installed copies. The npm CLI and hosted endpoint remain unchanged.

Each release also publishes the plugin as the root of
[pixeware/watchgoose-plugin](https://github.com/pixeware/watchgoose-plugin):

- Gemini CLI: `gemini extensions install https://github.com/pixeware/watchgoose-plugin`
- Grok Build: `grok plugin install pixeware/watchgoose-plugin --trust`
- Any agent that reads Agent Skills: `npx skills add pixeware/watchgoose-plugin`, then add the
  hosted endpoint in your client

## Development

```shell
npm install
npm run format:check
npm run lint
npm run typecheck
npm test
npm run publish:dry-run
```

Production integration tests are opt-in and require dedicated test-project keys. They never run in
CI.

Every user-visible distribution shares one release version: the npm package, `server.json`, the
hosted server, the Claude and portable plugin manifests and the OpenAI plugin. Bump
`WATCHGOOSE_RELEASE_VERSION` in `packages/core/src/constants.ts` and the matching manifests
together; `tests/skills/release-version.test.ts` fails if any of them disagree. The OpenAI upload
ZIP is built with `npm run build:openai-plugin`.

## Support

- Support: [support@watchgoose.com](mailto:support@watchgoose.com)
- Documentation: [watchgoose.com/docs/mcp](https://watchgoose.com/docs/mcp/)
- Privacy policy: [watchgoose.com/legal/privacy](https://watchgoose.com/legal/privacy/)
- Terms of service: [watchgoose.com/legal/terms](https://watchgoose.com/legal/terms/)

## License

MIT

## Various badges

[![MCP Badge](https://lobehub.com/badge/mcp/bartekrutkowski-watchgoose-mcp)](https://lobehub.com/mcp/bartekrutkowski-watchgoose-mcp)
