# Watchgoose MCP

Watchgoose MCP connects MCP-capable AI clients to the Watchgoose Management API. It lets you inspect
cron and recurring-task monitoring, with check changes available only when you explicitly enable
writes.

## Requirements

- Node.js 20 or later
- A project-scoped Watchgoose API key from **Project settings**

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

Checks are addressed by stable 40-character `unique_key` values. UUIDs, ping URLs, and integration
UUIDs are used only inside the server and are not shown to the AI client.

| Tool            | Required access                | Management API mapping                                  |
| --------------- | ------------------------------ | ------------------------------------------------------- |
| `list_checks`   | Read-only                      | `GET /checks/`                                          |
| `get_check`     | Read-only                      | `GET /checks/<unique_key>`                              |
| `list_flips`    | Read-only                      | `GET /checks/<unique_key>/flips/`                       |
| `list_pings`    | Read-write                     | Resolve `unique_key`, then `GET /checks/<uuid>/pings/`  |
| `list_channels` | Read-write                     | `GET /channels/`                                        |
| `create_check`  | Read-write plus writes enabled | `POST /checks/`                                         |
| `update_check`  | Read-write plus writes enabled | Resolve `unique_key`, then `POST /checks/<uuid>`        |
| `pause_check`   | Read-write plus writes enabled | Resolve `unique_key`, then `POST /checks/<uuid>/pause`  |
| `resume_check`  | Read-write plus writes enabled | Resolve `unique_key`, then `POST /checks/<uuid>/resume` |
| `delete_check`  | Read-write plus writes enabled | Resolve `unique_key`, then `DELETE /checks/<uuid>`      |

Integration assignments use exact integration names. Names must be non-empty and unique within the
project.

List results are capped at 100 checks, 100 pings, 200 flips, and 100 integrations. Every serialized
tool result is also capped at 24,000 characters. Results include metadata when entries are omitted.

## Security

- Writes are disabled by default, even with an `hcw_` key.
- The API key is sent only in the `X-Api-Key` header and is never logged or returned.
- API redirects are rejected so credentials cannot be forwarded to another host.
- Check UUIDs, ping and update URLs, integration UUIDs, and unknown future API fields are removed
  from output.
- Pings keep only `type`, `date`, `n`, `scheme`, `method`, and `duration`. Source IP addresses, user
  agents, run IDs, and body URLs are removed.
- Ping bodies are never requested.
- The server has no telemetry.

Protect client configuration files that contain API keys. Prefer a dedicated project and the
least-privileged key that exposes the tools you need. Revoke a key from Watchgoose project settings
when it is no longer in use.

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

## License

MIT
