# Watchgoose monitoring

Five workflow skills help you review scheduled-job monitoring with the existing Watchgoose MCP
connector. This package contains guidance and a remote connection configuration, not a local MCP
server or package installation.

## Workflows

- Coverage audit: inspect authorized scheduling evidence and identify confirmed gaps or unknowns.
- Single-job setup: draft settings and instrumentation for one identified recurring job.
- Missed-run triage: summarize bounded check status and available history without inventing causes.
- Health review: review activation, pauses, routing evidence and runtime headroom.
- Batch setup: propose new checks and carry out only explicitly approved creation, with capacity
  confirmed or explicitly acknowledged as unverified.

## Connection and permissions

Use your client's connection controls for the declared Watchgoose HTTPS MCP connector. Browser OAuth
consent selects one project and defaults to read-only access. Existing organization policies and
permissions apply. Avoid enabling duplicate manually configured copies of the same endpoint. Audit
can also work offline with supplied redacted files; other workflows disclose missing tools. Pings
and routing metadata require existing broader access; guidance never expands it automatically.

## Network endpoints and credentials

The plugin itself contacts one endpoint: the hosted MCP server at `https://mcp.watchgoose.com/mcp`.
On first use your client opens the OAuth authorization flow on `https://mcp.watchgoose.com`, which
sends you to `https://watchgoose.com/mcp/connect/` to sign in and choose a project. The only
credential is the OAuth grant your client stores after that consent. The package contains no API
keys, environment variables, hooks or executables. The optional heartbeat wrapper draft, if an
operator installs it, posts to the private check URL they store in `WATCHGOOSE_PING_URL`.

## Safety and operator handoff

Check mutations require explicit approval and available write tools. Counts and histories are
bounded and project-scoped, not account inventory or quota. Batch creation is sequential and
non-atomic: preserve successes and stop on errors or uncertain outcomes without automatic replay or
rollback.

The skills do not automatically install instrumentation, execute scheduled jobs, read secret stores
or send heartbeats. Setup references include an operator-reviewed shell-wrapper draft that runs one
supplied job and posts success or failure to Watchgoose after the job. Missing heartbeat
configuration does not prevent the job from running. Installation and execution belong to the
operator's trusted job runner, not the plugin; an optional start signal requires separate operator
review. Keep private heartbeat URLs in the runner's secret environment, never in chat, source or
logs. No URL is reconstructed from a tool lookup token. Verify the first real successful job run
rather than sending a test heartbeat.

Use the [Watchgoose MCP documentation](https://watchgoose.com/docs/mcp/) for connection and tool
boundaries and the [privacy policy](https://watchgoose.com/legal/privacy/) for data handling. The
portable source adapter shares these same canonical skills; host support varies. Installing
individual skills does not automatically connect MCP. Local validation is not native compatibility,
directory approval or public publication. MIT licensed.
