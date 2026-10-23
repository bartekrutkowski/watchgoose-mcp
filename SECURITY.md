# Security policy

## Reporting a vulnerability

Email support@watchgoose.com with "Security" in the subject. Include the affected component (hosted
server at `mcp.watchgoose.com`, the `watchgoose-mcp` npm package, or the monitoring plugin), the
steps to reproduce, and the impact you observed. Please don't open a public issue for a
vulnerability, and don't include real API keys, OAuth tokens or customer data in the report.

We reply to confirm we received the report and tell you when a fix is released.

## Supported versions

Security fixes go into the latest release of the npm package and the plugin, and are deployed to the
hosted server. Older npm versions are not patched; upgrade to the latest `watchgoose-mcp`.

## Scope

- The hosted MCP server and its OAuth authorization server at `https://mcp.watchgoose.com`
- The `watchgoose-mcp` npm package
- The skills and manifests in `plugins/watchgoose-monitoring/` and
  [pixeware/watchgoose-plugin](https://github.com/pixeware/watchgoose-plugin)

Issues in the Watchgoose web application or Management API can be reported the same way.
