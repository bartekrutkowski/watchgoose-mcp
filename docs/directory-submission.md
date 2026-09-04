# MCP directory submission pack

This is the owner-run submission pack for the hosted Watchgoose MCP server. Revalidate every form,
policy, schema, endpoint, and draft specification immediately before submission. Do not submit until
the reviewed server, documentation, privacy copy, icon, and OAuth flow are live.

Never commit reviewer credentials, session cookies, authorization codes, access or refresh tokens,
delegated credentials, API keys, client secrets, or unredacted screenshots.

## Canonical listing payload

| Field               | Value                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                | Watchgoose                                                                                                                                                                                                                                                 |
| Permanent slug      | `watchgoose`                                                                                                                                                                                                                                               |
| Tagline             | Monitor cron jobs and recurring work in Claude.                                                                                                                                                                                                            |
| Description         | Connect one Watchgoose project to inspect checks and status history. Read-only access is the default. With explicit read-and-write consent, the connector can inspect recent signals and integrations and create, update, pause, resume, or delete checks. |
| Remote URL          | `https://mcp.watchgoose.com/mcp`                                                                                                                                                                                                                           |
| Transport           | Streamable HTTP                                                                                                                                                                                                                                            |
| Authentication      | OAuth 2.1 authorization code flow, PKCE S256, and Dynamic Client Registration                                                                                                                                                                              |
| OAuth issuer        | `https://mcp.watchgoose.com`                                                                                                                                                                                                                               |
| Documentation       | `https://watchgoose.com/docs/mcp/`                                                                                                                                                                                                                         |
| Privacy             | `https://watchgoose.com/legal/privacy/`                                                                                                                                                                                                                    |
| Support             | `mailto:support@watchgoose.com`                                                                                                                                                                                                                            |
| Repository          | `https://github.com/bartekrutkowski/watchgoose-mcp`                                                                                                                                                                                                        |
| Square SVG icon     | `https://watchgoose.com/static/img/watchgoose-mcp.svg`                                                                                                                                                                                                     |
| Square PNG fallback | `https://watchgoose.com/static/img/watchgoose-icon-512.png`                                                                                                                                                                                                |

The approved tagline is fixed. Do not expand it into uptime, SLA, diagnosis, remediation, log
aggregation, or execution-analytics claims.

## Claude connector directory

Remote connector submissions currently use
`https://claude.ai/admin-settings/directory/submissions/new`. The submitting account must be an
Owner or Primary owner of a Claude Team or Enterprise organization, or have an Enterprise custom
role with the Directory or Libraries permission. Confirm that access before provisioning review
credentials.

The submission approved as a community connector on 2026-08-28 used these values. They supersede the
canonical payload where they differ:

| Portal field   | Approved value                                                                    |
| -------------- | --------------------------------------------------------------------------------- |
| Name           | Watchgoose                                                                        |
| One-liner      | Monitor cron jobs, backups, Kubernetes jobs and recurring scripts in Claude.      |
| Author         | Watchgoose.com                                                                    |
| Icon           | `https://watchgoose.com/static/img/watchgoose-icon-512.png`                       |
| Category       | Development tools                                                                 |
| Authentication | `oauth_dcr`                                                                       |
| Review outcome | Approved as a community connector with permanent slug `watchgoose` on 2026-08-28. |

The submitted detail fields used these values in addition to the approved values above:

| Portal field           | Prepared value                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Categories             | Select `Developer tools` and `Productivity` only if those exact labels remain available. Otherwise choose the closest current factual labels and record the change for review.                                                  |
| Primary use cases      | Inspect check state, schedules, and retained status changes; inspect recent signals and integration names after explicit read-and-write consent; create, update, pause, resume, and delete checks after explicit write consent. |
| User prerequisites     | A Watchgoose account with access to at least one project. The connector works with a free-plan project; paid features are not required.                                                                                         |
| Read/write declaration | Both. Read-only is the consent default. Recent pings, integration names, and mutations require a new authorization with read-and-write access.                                                                                  |
| Company name           | Enter the exact deployed `COMPANY_LEGAL_NAME`; do not infer or abbreviate it in this public repository.                                                                                                                         |
| Company website        | `https://watchgoose.com/`                                                                                                                                                                                                       |
| Primary contact        | Owner enters the current responsible name and monitored email in the portal.                                                                                                                                                    |
| Underlying API         | First-party Watchgoose Management API, owned and operated by the submitting company. No partner or third-party API is proxied.                                                                                                  |
| Personal health data   | No. Watchgoose prohibits regulated health-record use unless agreed in writing, and the connector is not designed for health data.                                                                                               |
| Sponsored content      | None.                                                                                                                                                                                                                           |
| Allowed link URIs      | None. The server exposes tools only and does not use the MCP Apps `ui/open-link` capability.                                                                                                                                    |

The current portal accepts a 100-character name, 55-character tagline, 2,000-character description,
one to five categories, permanent slug, documentation and privacy URLs, support contact, and icon.
Revalidate those limits immediately before submission.

Prepare these redacted review artifacts:

1. A fresh request to the protected-resource metadata endpoint showing the canonical resource and
   authorization server.
2. A fresh authorization-server metadata response showing the authorization-code grant, S256 PKCE,
   Dynamic Client Registration endpoint, and supported scopes.
3. A successful DCR response with client identifiers and redirect URIs redacted.
4. The Watchgoose consent screen showing one selected project, read-only selected by default, and
   the requested ongoing-access explanation.
5. A read-only connection exposing exactly `list_checks`, `get_check`, and `list_flips`.
6. A read-and-write reconnection showing the explicit consent choice and all ten tools.
7. Successful list, create, update, pause, resume, and delete behavior against a disposable reviewer
   project, with all project identifiers and returned data redacted.
8. Revocation under **Account settings > MCP Connections**, followed by a rejected tool call and a
   successful fresh reconnection.
9. The live documentation, privacy, support, icon, service-status, and repository URLs.

Create the reviewer account and disposable project outside Git. Deliver credentials only through
Anthropic's current approved secret channel. Require password reset or revoke the account when
review ends. Record the reviewer account owner and expiry in the private operator record, not here.

Before acknowledging any submission statement, compare its current wording with the live behavior,
privacy policy, Anthropic's connector terms, the MCP security guidance, and Watchgoose's Product
Truth table. The owner, not an implementation agent, accepts legal and compliance terms.

Prepare these answers for the portal's seven required compliance acknowledgments, then compare them
with the exact live acknowledgment text before the owner accepts it:

1. **Directory guidelines:** the listing, tools, documentation, support process, and privacy policy
   must remain accurate and maintained under the current Software Directory Terms and Policy.
2. **First-party API:** yes. The connector uses only Watchgoose's own public Management API. It does
   not proxy an API without permission.
3. **Financial transactions:** none. No tool purchases, subscribes, changes billing, transfers
   money, or initiates another financial transaction.
4. **AI media generation:** none. No tool generates or edits images, audio, video, or likenesses.
5. **Prompt injection:** tool output can include text entered by members of the connected Watchgoose
   project, such as check names, descriptions, tags, and integration names. The server does not turn
   that text into instructions or fetch third-party content, and it restricts output to an explicit
   field allowlist. Reviewers should still treat all tool output as untrusted data.
6. **Conversation data:** the connector does not receive or collect Claude conversations. It
   receives only MCP tool arguments and sends the corresponding project-scoped API requests. The MCP
   application adds no telemetry.
7. **Public documentation:** setup, tools, scope behavior, privacy, retention, revocation, and
   support are published at the canonical documentation and privacy URLs above.

Track review status in `https://claude.ai/admin-settings/directory/submissions`. Use
`mcp-review@anthropic.com` only for submission escalations.

## OpenAI plugin directory

This is an owner-run submission to the plugin directory shared by ChatGPT and Codex. Revalidate the
[submission requirements](https://developers.openai.com/plugins/deploy/submission) and
[review requirements](https://developers.openai.com/plugins/deploy/app-review) immediately before
every scan or submission. The owner must have a Platform organization, complete business
verification for the deployed `COMPANY_LEGAL_NAME`, and hold **Apps Management: Write**. Business
verification, portal terms, deployment, testing, submission, and publication are owner actions.

Create the plugin with **Create plugin > With MCP** and use:

| Portal field        | Value                                                        |
| ------------------- | ------------------------------------------------------------ |
| Universal MCP URL   | `https://mcp.watchgoose.com/mcp`                             |
| Authentication      | OAuth with Dynamic Client Registration                       |
| Documentation       | `https://watchgoose.com/docs/mcp/`                           |
| Privacy             | `https://watchgoose.com/legal/privacy/`                      |
| Terms               | `https://watchgoose.com/legal/terms/`                        |
| Support             | `support@watchgoose.com`                                     |
| Domain verification | `/.well-known/openai-apps-challenge` on `mcp.watchgoose.com` |

Set `OPENAI_APPS_CHALLENGE_TOKEN` only from the private deployment environment. The endpoint returns
the exact configured value as `text/plain` with no trailing newline and returns 404 when unset. The
token never belongs in Git, screenshots, shell history, or review notes. The production container
must receive the variable explicitly; Docker Compose does not automatically pass arbitrary host
variables into a service.

Run **Scan Tools** only after the reviewed revision and challenge are live. Scan Tools stores a
submission-time metadata snapshot; calls continue to use the live server, but tool metadata changes
require another scan, review, and publication. Compare the scan against source before submitting.

### Annotation justification

All tools use `openWorldHint: false`: Watchgoose is a closed first-party system, and no tool changes
public internet state. A notification later emitted because a check changes status is downstream
product behavior of that check, not an external side effect of the MCP tool call.

Pre-change deployment evidence is bounded but consistent: the owner deployed public merge `360e1a5`,
the corrected Claude portal scan captured all ten tools from that deployment, and Anthropic approved
the submission after checking the reviewed names, descriptions, and three existing annotations. The
source metadata test locks that exact set. Neither deployed `360e1a5` nor its source had
`openWorldHint`, so there was no hidden deployed/source divergence before T-154. T-154 intentionally
creates a four-annotation source/deployment difference until it is deployed. Before OpenAI Scan
Tools, capture the authorized read-write `tools/list` response and require all ten records to match
the source test exactly, including `openWorldHint: false`.

| Tool            | Read only | Destructive | Idempotent | Open world | Submission justification                                                                                                      |
| --------------- | --------- | ----------- | ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `list_checks`   | Yes       | No          | Yes        | No         | Reads project checks only.                                                                                                    |
| `get_check`     | Yes       | No          | Yes        | No         | Reads one project check only.                                                                                                 |
| `list_pings`    | Yes       | No          | Yes        | No         | Reads retained signals only.                                                                                                  |
| `list_flips`    | Yes       | No          | Yes        | No         | Reads retained status changes only.                                                                                           |
| `list_channels` | Yes       | No          | Yes        | No         | Reads integration names and kinds only.                                                                                       |
| `create_check`  | No        | No          | No         | No         | Creates a project check; retries can create another check. Any later notification is downstream check behavior.               |
| `update_check`  | No        | Yes         | Yes        | No         | Replaces selected project-check settings and may remove existing values. Any later notification is downstream check behavior. |
| `pause_check`   | No        | Yes         | Yes        | No         | Stops monitoring state for a project check. Any later notification is downstream check behavior.                              |
| `resume_check`  | No        | Yes         | Yes        | No         | Restarts monitoring state for a project check. Any later notification is downstream check behavior.                           |
| `delete_check`  | No        | Yes         | No         | No         | Permanently deletes a project check and retained history.                                                                     |

### Discovery and consent recommendation

The protected-resource document advertises `mcp:read` and `mcp:write`. Under the MCP scope-selection
strategy, a client that receives no narrower scope signal may request all resource scopes; OpenAI's
actual authorization URL, including whether it adds `offline_access`, must still be captured during
owner testing. Watchgoose then shows read-only and read-and-write choices, with read-only selected
by default. The effective grant, not the DCR registration metadata, controls tool visibility:

| Effective consent | Live `tools/list` result                     |
| ----------------- | -------------------------------------------- |
| Read only         | `list_checks`, `get_check`, and `list_flips` |
| Read and write    | All ten tools                                |

Scan Tools therefore captures three tools after read-only consent or ten after read-and-write
consent. A ten-tool snapshot paired later with a read-only connection could advertise seven tools
that the live server intentionally does not register. OpenAI's public documentation explains the
snapshot but does not specify whether the client reconciles that mismatch or performs scope step-up.

Do not change Watchgoose's consent model in this ticket. Before submission, capture the requested
scope, perform both consent choices in ChatGPT developer mode, and verify whether the client
refreshes the live list. If it does not, the safe initial submission is the coherent three-tool
read-only snapshot. A ten-tool-only listing, per-tool scope metadata, or a separate OpenAI access
model needs an owner decision and a separately reviewed ticket.

### Dynamic registration longevity

Dynamic registrations are distinct records; repeating the same registration does not deduplicate by
host or client name. A client that retains its unexpired `client_id` can reuse it across reconnects
and deployments while the SQLite volume and encryption key remain intact. Reauthorization still
forces consent and creates fresh grant state. Refresh tokens rotate, concurrent reuse permits one
success, and grant invalidation does not delete the DCR client, so the same client can reconnect.

Client registrations and refresh grants expire after 30 days. Pruning removes expired rows in
bounded batches. Storage is capped at 10,000 DCR clients, 100,000 refresh/grant rows, and 50,000
transient rows; capacity checks fail closed. A client that registers again instead of reusing its
identifier grows the DCR table until expiry and pruning. A follow-up ticket owns admission rate
limits, capacity alerting, and additional repeated-registration/reconnect lifecycle coverage; do not
weaken public DCR or deduplicate shared hosts speculatively.

### CIMD decision memo

Client ID Metadata Documents are additive in principle but are not a metadata-only switch. A safe
implementation must enable the pinned provider's CIMD support, advertise
`client_id_metadata_document_supported`, retain DCR, constrain metadata and JWKS fetching against
SSRF and DNS rebinding, validate redirect and token-auth negotiation, and canary existing DCR
clients. The code is small, but the authentication assurance and live-client matrix make this a
separate medium-risk effort of roughly one to two engineering days plus owner-run live validation.

OpenAI documents DCR as supported and lets the plugin builder select it. Recommendation: keep DCR
for this submission and file CIMD separately only after owner approval or verified Smithery demand.
An additive implementation should preserve existing client IDs, grants, refresh tokens, and
`/register`, but new clients may prefer CIMD once it is advertised. See OpenAI's
[client registration guidance](https://developers.openai.com/plugins/build/auth#client-registration)
and the MCP
[CIMD security considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations#client-id-metadata-document-security).

### OAuth versus workspace OIDC

OpenAI's general plugin authentication guidance accepts OAuth authorization-server metadata and DCR.
Its `openid`, `email`, UserInfo, and `email_verified: true` requirements are documented under
[workspace domain restrictions](https://developers.openai.com/plugins/build/auth#support-workspace-domain-restrictions),
not as a general gate for a public universal MCP plugin. Watchgoose does not request workspace
domain restrictions, advertise OIDC scopes, or expose UserInfo. Do not add OIDC unless the current
portal or OpenAI support explicitly requires it; doing so would change scopes and consent behavior
outside this ticket. The owner must preserve a screenshot or support response if the live form
contradicts the published guidance.

### Response-field inventory

Every success returns schema-valid `structuredContent` and one MCP text block containing the exact
same payload as serialized JSON for backward compatibility. List results include `meta.returned`,
`meta.available_in_response`, `meta.omitted`, `meta.truncated`, and, only when user-controlled
strings were shortened, `meta.truncated_fields`. Object results may include only
`meta.truncated_fields: true`. The per-tool JSON payloads are:

| Tool            | Top-level payload    | Item fields                                                     |
| --------------- | -------------------- | --------------------------------------------------------------- |
| `list_checks`   | `checks[]`, `meta`   | Check fields below; `channels` is omitted for read-only grants. |
| `get_check`     | `check`              | Check fields below; `channels` is omitted for read-only grants. |
| `list_pings`    | `pings[]`, `meta`    | `type`, `date`, `n`, `scheme`, `method`, `duration`             |
| `list_flips`    | `flips[]`, `meta`    | `timestamp`, `up`                                               |
| `list_channels` | `channels[]`, `meta` | `name`, `kind`                                                  |
| `create_check`  | `check`              | Check fields below; resolved `channels` may be present.         |
| `update_check`  | `check`              | Check fields below; resolved `channels` may be present.         |
| `pause_check`   | `check`              | Check fields below; resolved `channels` may be present.         |
| `resume_check`  | `check`              | Check fields below; resolved `channels` may be present.         |
| `delete_check`  | `deleted`            | Check fields below; resolved `channels` may be present.         |

The check allowlist is `unique_key`, `name`, `slug`, `tags`, `desc`, `grace`, `n_pings`, `status`,
`started`, `last_ping`, `next_ping`, `last_duration`, `manual_resume`, `methods`, `subject`,
`subject_fail`, `start_kw`, `success_kw`, `failure_kw`, `filter_subject`, `filter_body`,
`filter_http_body`, `filter_default_fail`, `timeout`, `schedule`, and `tz`. Optional `channels[]`
items contain only `name` and `kind`. `unique_key` is an opaque stable 40-character check reference
derived from the UUID; the raw UUID is never returned.

No raw user, project, check, integration, or ping identifiers; ping URLs; delegated API credentials;
OAuth tokens; source addresses; user agents; run IDs; ping bodies or body URLs; internal capability
URLs; debug payloads; or raw API errors are returned. The generated `meta` object contains bounded
result counts and truncation state, not telemetry. The MCP application adds no telemetry.

### Submission artifacts and reviewer access

These submission artifacts do not exist yet and must be prepared outside Git against the live
reviewed revision: starter prompts; at least five positive and three negative cases passing on
ChatGPT web and mobile; the portal CSP declaration if requested for this MCP-only/no-custom-UI
plugin; final logo and category selection; country availability; and release notes. No plugin output
may link to checkout or an upgrade flow; commerce through plugins is restricted to physical goods.
An informational plan-requirement link is allowed only if it does not initiate purchase.

Create a separate disposable OpenAI reviewer account and project with no MFA, SMS,
email-confirmation, or private-network step. Do not reuse the Claude reviewer account. Store
credentials only in the owner's private secret channel and revoke the account after review. Rotate
or revoke the Claude reviewer credential now that its review has closed.

Before submission, prove the existing Claude connection still works without reauthorization and a
fresh Claude Code loopback authorization still succeeds. Then capture ChatGPT OAuth, Scan Tools, all
ten disposable tool calls, write confirmations, negative cases, revocation, and reconnect on web and
mobile. After publication, verify Codex discovers the same directory plugin and completes OAuth plus
a real `list_checks` call. If the current Codex client does not expose directory plugins, record its
exact version and the current OpenAI documentation or support answer instead of claiming a
successful Codex test. Rescan after any metadata change and revalidate every requirement before the
owner submits.

## Official MCP Registry

`server.json` is the source payload. It uses the GitHub-authenticated namespace
`io.github.bartekrutkowski/watchgoose-mcp`, matching both the repository and npm package name. It
advertises the hosted Streamable HTTP endpoint and the exact `watchgoose-mcp@0.1.2` stdio package.

After the live acceptance checks:

```shell
mcp-publisher login github
mcp-publisher publish
curl -fsS "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.bartekrutkowski/watchgoose-mcp"
```

Before publishing, validate `server.json` against the schema URL in its `$schema` field, confirm the
registry remains in preview, and require `watchgoose-mcp@0.1.2` to be live on npm first.

## Aggregator status

The selected aggregator sweep was completed on 2026-09-03. Revalidate each service before any later
change rather than relying on this dated snapshot. Smithery removed its auto-listing, so do not
resubmit there. Its hosted DCR/CIMD compatibility remains unverified secondary context, not a reason
to implement CIMD without separately approved demand.

| Directory | Status as of 2026-09-03                                | Note                                                             |
| --------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| mcp.so    | Paid-only submission; skipped                          | No paid placement was purchased.                                 |
| Smithery  | Auto-listing removed by platform                       | Do not submit. Hosted DCR/CIMD compatibility remains unverified. |
| PulseMCP  | Closed to submissions                                  | Ingests the official MCP Registry.                               |
| Glama     | Claimed; release 1.0.0; Install enabled; Maintenance A | Uses npm `watchgoose-mcp@0.1.1`; Parameters is 2/5.              |

### Version 0.1.2 listing update

After the reviewed 0.1.2 changes are merged, the owner publishes and verifies `watchgoose-mcp@0.1.2`
on npm, republishes `server.json` to the official MCP Registry, runs a new Glama release, and
confirms the Glama Parameters score is above 2/5. Update the dated aggregator table only after those
live checks pass.

Use this exact short description where a directory does not provide separate tagline and description
fields:

> Monitor cron jobs and recurring work through a project-scoped Watchgoose connection. Read-only
> access is the default; changes require explicit consent.

## Announcement copy

Changelog:

> Watchgoose now connects to Claude and other remote MCP clients. Choose one project and start with
> read-only access to checks and status history. You can explicitly reconnect with read-and-write
> access when you want the client to manage checks. See https://watchgoose.com/docs/mcp/.

X:

> Watchgoose now has a hosted MCP connector for Claude and other remote clients. Connect one
> project, start read-only, and explicitly opt into check changes when needed.
> https://watchgoose.com/docs/mcp/

## DNS-AID preparation

Revalidation on 2026-08-27 found that `draft-mozleywilliams-dnsop-dnsaid-02` remains an individual
Internet-Draft, expires on 2026-11-28, and does not define the previously proposed `_mcp._agents`
owner name. Draft-02 instead describes a known agent at its primary owner name and shows `mcp` as an
unconfirmed placeholder ALPN identifier. The draft also defers IANA code points for capability
parameters.

For that reason, do not apply the obsolete prepared record:

```dns
_mcp._agents.watchgoose.com. IN SVCB 1 mcp.watchgoose.com.
```

The current draft candidate would be structurally similar to this, but it is also **not approved for
application** while the MCP ALPN identifier and DNS-AID draft remain unregistered:

```dns
mcp.watchgoose.com. IN SVCB 1 . alpn="mcp,h2" port=443
```

Immediately before any owner-applied DNS change, retrieve the newest draft, check the IANA ALPN and
SvcParamKey registries, confirm Cloudflare's SVCB representation, produce a minimal OpenTofu plan,
and require DNSSEC-valid answers from two independent resolvers. If the identifiers are still draft
or unregistered, leave DNS unchanged.

## Owner execution order

1. Push and deploy the reviewed T-151 authority.
2. Push and deploy the reviewed T-152 hosted service and DNS.
3. Complete live OAuth, DCR, read-only, write-consent, revocation, rollback, secret-readability, and
   backup/restore acceptance.
4. Publish the reviewed T-153 documentation, privacy copy, and icon.
5. Regenerate and submit the canonical IndexNow inventory after the documentation deploy.
6. Capture redacted evidence and provision the time-bounded reviewer account.
7. Submit to Claude first. After it is published, publish and verify `watchgoose-mcp@0.1.1` on npm,
   then publish the official MCP Registry record and selected aggregators.
8. Record every accepted, rejected, or pending listing in the canonical owner workbook.
9. Apply no DNS-AID MCP record unless revalidation resolves the draft and registration blockers.
