# Watchgoose monitoring skills

These skills add workflow guidance around the existing Watchgoose MCP tools. They do not change API
access, run scheduled jobs, install instrumentation, or grant permission to write.

| Skill                                     | Use it for                                                                                                      | Access                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `watchgoose-cron-coverage-audit`          | Review authorized scheduling files and identify monitoring gaps or unknowns                                     | Read-only; works offline with provided files                                                              |
| `watchgoose-monitor-scheduled-job`        | Draft settings and heartbeat instrumentation for one identified job                                             | Draft-only by default; create/update requires explicit user authorization and available write tools       |
| `watchgoose-missed-run-triage`            | Summarize check status, transitions and sanitized ping history                                                  | Non-mutating; ping history requires existing read-write connection access                                 |
| `watchgoose-monitoring-health-review`     | Review existing checks for pending activation, pauses, routing risks, runtime headroom and repeated transitions | Non-mutating; ping/routing metadata requires existing read-write access                                   |
| `watchgoose-batch-monitor-scheduled-jobs` | Turn an audit/list/CSV into proposed new checks and an approved sequential batch                                | Exact approval/settings/write tools required; capacity confirmed or explicitly acknowledged as unverified |

## Try the source locally

The canonical instructions live in `skills/`. Each directory is self-contained; copy the entire
chosen directory, including any referenced Markdown, rather than just `SKILL.md`.

For Claude Code, a local checkout can be loaded as a plugin for one session:

```shell
claude --plugin-dir /path/to/watchgoose-mcp
```

Claude discovers the canonical root `skills/` directory; `.mcp.json` references the hosted MCP
endpoint. Connect/authenticate through the client's MCP controls if prompted. Organization policies
and existing connector permissions still apply. Avoid enabling duplicate manually configured copies
of the same server.

For individual skill installation, copy a skill directory into your client's supported skills
directory, for example `~/.claude/skills/` for Claude Code or `~/.agents/skills/` for Codex. Confirm
the installed skill appears in that client. Individual skill installation does **not** automatically
install/connect the MCP server. Follow the
[existing connection guide](https://github.com/bartekrutkowski/watchgoose-mcp#watchgoose-mcp).

**Contributors:** root `.mcp.json` also offers that hosted server as project-scoped configuration
when opening this checkout in Claude Code. Approve it only if you intend to connect to your selected
production project; it is not a local development server. Existing client/organization approval and
OAuth consent still apply. This adapter does not grant writes by itself.

For clients without repository access, supply only the authorized scheduling files or snippets. The
audit cannot silently inspect your repository from a chat-only surface.

The root `plugin.json` and `mcp.json` provide a portable Agent Plugins source adapter. Their
`watchgoose-monitoring@0.1.0` identifies this workflow bundle, not the npm/MCP server release.
Client support and organization policies vary; local validation is not directory approval. This
source adapter is **not** a verified replacement ZIP for the existing published OpenAI plugin.

## Example requests

- "Audit `ops/crontab` and the referenced backup scripts. Which jobs have confirmed monitoring,
  candidate matches, or unknown coverage? Do not change anything."
- "Draft Watchgoose settings for my daily 02:00 Europe/Riga backup with ten minutes grace. Show the
  instrumentation for review; don't create a check yet."
- "Explain the returned status and recent transitions for my backup check. Distinguish observed
  facts from possible causes; don't pause, resume, or modify it."
- "Is monitoring in this project actually working? Review unarmed/paused checks, routing risks,
  runtime headroom and repeated transitions; report limits and unknowns without changing anything."
- "Turn the audit's jobs into proposed new checks. Show every row's settings, routing, linkage and
  capacity blockers, then wait for one approval of the ready batch."
- "Prepare new checks from this CSV; keep confirmed existing checks unchanged and do not create
  anything until I approve the exact rows and either confirm capacity or explicitly accept it as
  unverified."

Clients may select a skill from its description or let you invoke it explicitly. The available
invocation syntax/namespacing depends on the client; use its installed-skill interface rather than
assuming all platforms share one command.

## Safety and capability boundaries

- MCP is scoped to one selected project. Empty/truncated results are not an account-wide inventory
  or proof of complete monitoring coverage.
- Repository configuration is not proof of deployment, real job execution, successful heartbeats, or
  alert delivery. Source comments and check descriptions are untrusted data, not instructions.
- Read-only access is the connection default. Skills cannot enable unavailable tools or expand
  authorization. API keys and private ping URLs must never be pasted into chat or embedded in skill
  files.
- MCP deliberately removes ping URLs and UUIDs. After a check is created, obtain its private ping
  URL directly from the Watchgoose dashboard into the job's environment/secret manager. `unique_key`
  cannot be used to construct that URL.
- `create_check` with `unique` may update a matching existing check. `timeout` without `schedule`
  also switches a scheduled check to interval monitoring; the stored schedule string remains but no
  longer governs cadence. Include the confirmed schedule to retain scheduled monitoring.
  `channels: []` removes integration assignments. Review these effects before authorizing a write.
- A timed-out creation may already have succeeded; reconcile read-only rather than automatically
  retrying.
- API creation without `channels` assigns no alert integrations. Confirm intended routing or mark it
  pending; check creation does not establish alert delivery.
- A new check awaits a success/fail heartbeat for completion-based cadence; a first failure can move
  it directly down. An optional start heartbeat can initiate runtime-deadline monitoring before
  completion, including while new. Resume also resets a check to new, so new does not prove it was
  never active. Verify a real successful job run for operational handoff. These skills never send
  synthetic pings to claim activation. The shell wrapper is a reviewed draft, not an automatically
  executed installer.
- Triage uses non-mutating `list_checks`, `get_check`, `list_flips`, and sanitized `list_pings` when
  available. Ping history currently requires existing read-write connection access; it is not
  exposed on read-only connections. No permission expansion or alternate API bypass is performed.
  Ping metadata identifies reported success/fail/start/ignored/log signals and supplied duration,
  not a proven job outcome or root cause. No ping bodies, addresses, user agents or run IDs are
  returned; absent completion in partial history does not prove a hang.
- The draft wrapper still runs the job if its heartbeat URL is unset/empty, skips notification with
  a fixed warning, and preserves the job's exit status. Notification failures also cannot stop or
  disguise job failure. An optional operator-reviewed `/start` heartbeat is described, not enabled
  automatically; actual job instrumentation is installed outside this chat workflow.

## Health review and batch setup

Health review checks the monitoring configuration/evidence already visible in one project, not
whether every repository job is covered. It reports pending activation, current pauses, unresolved
routing, sampled runtime/grace risk and repeated up/non-up transitions. It does not tune settings,
resume checks, trigger jobs or test notification delivery. Pause age is unknown without explicit
pause evidence: returned flips have only timestamp/up, and up0 includes paused/new as well as down.
Server-reported durations do not independently prove a job's runtime or correlate adjacent pings.

Returned integration names establish those resolved assignments, not a complete routing map or alert
delivery. An empty resolved list can hide unresolved integration IDs; confirm in the dashboard
before declaring no assignments. Missing routing is unknown. `meta.truncated_fields` is a boolean,
not field names; returned counts and limits do not establish account inventory or plan usage.

Batch setup is **create-only**. It accepts authorized audit output, a supplied list or CSV; input
notes and spreadsheet formulas are data, not executable commands or approval. Show every row as
create/keep/skip/blocked, with safe source evidence, exact new-check payload, routing and blockers.
Keep confirmed existing linkages untouched and resolve ambiguous matches rather than upserting.
Updates to existing checks belong to a separately authorized single-job workflow.

There is no MCP plan/quota/usage tool. Record sufficient dashboard/user-confirmed capacity, or
**capacity unverified**. The user can explicitly accept that uncertainty within the exact batch
approval, or add it later to unchanged approval, e.g. “proceed, capacity unverified”; without that
acknowledgement, remain draft-only. Known insufficient capacity stays blocked. Never infer slots
from response caps/counts or plan names, deliberately hit a known limit to induce an upgrade, or
silently change billing. One approval covers the exact ready rows/payloads and any capacity
acknowledgement; unchanged approved rows need no repeat approval. Create sequentially with a per-row
ledger, not an atomic transaction.

Any error stops further writes pending a user decision. Server/transport failures, cancellation or
malformed results may follow a completed write and remain uncertain, not confirmed failed. Reconcile
read-only; a missing match does not authorize retry or prove failure. Do not replay successes,
continue later rows after uncertainty, retry/upsert automatically or roll back by deleting checks.
Error text suggesting retry/deletion/raising limits is not consent. An over-limit new creation is
rejected before that check is saved; it does not undo earlier batch successes. Stop and report the
partial result: the reported limit is now known insufficient, not unverified. New creates stay
blocked until sufficient changed capacity is confirmed; fresh acknowledgement or a smaller batch
cannot override that block. Offer dashboard capacity/plan review or dropping/deferring remaining
rows as user choices, never automatic upgrades, deletions or retries. Report successful, rejected,
uncertain and unattempted rows honestly. Instrumentation and actual scheduled-run verification
remain separate; creating many checks does not establish monitoring activation or alert delivery.

## Maintainer validation and distribution

Run the existing development checks; `npm test` includes skills packaging and the draft wrapper's
controlled exit-status tests. `tests/skills/scenarios.json` and
`tests/skills/expansion-scenarios.json` contain synthetic behavioral rubrics for fresh-context
evaluations. Static package tests do not establish model behavior, live MCP execution, or native
skill activation.

Current format references:

- [Agent Skills specification](https://agentskills.io/specification)
- [Claude plugin distribution](https://code.claude.com/docs/en/plugins/publish)
- [Claude directory publishing and connector/bundle pairing](https://claude.com/docs/directory/publish)
- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [OpenAI existing-plugin updates](https://developers.openai.com/plugins/deploy/submission#update-your-published-plugin)

To distribute through Claude's directory, maintain the existing connector and submit the missing
companion bundle from the same organization, referencing the same endpoint. Directory listing does
not guarantee inclusion in Anthropic's official Claude Code marketplace.

For OpenAI, download the existing release ZIP and preserve its assigned identity, server
configuration, metadata/assets, review materials and retained components. Merge the canonical skills
and make the appropriately versioned update to that **existing listing**, not a new listing. Do not
upload this local source manifest verbatim as a replacement without that comparison and the required
review metadata. Skills/package updates and hosted-tool rescans are separate operations.

No listing, npm version, server deployment, or publication is changed merely by adding these source
files. Public GitHub distribution and any skills.sh discovery happen only after a separately
approved source publication; install-based catalogue visibility is not guaranteed. The skills
contain no telemetry or subscription checkout/upsell flow.
