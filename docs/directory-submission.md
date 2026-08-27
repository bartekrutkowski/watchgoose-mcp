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

Use these portal values in addition to the canonical listing payload:

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

## Official MCP Registry

`server.json` is the source payload. It uses the GitHub-authenticated namespace
`io.github.bartekrutkowski/watchgoose`, advertises only the hosted Streamable HTTP endpoint, and
does not claim an unpublished npm package.

After the live acceptance checks:

```shell
mcp-publisher login github
mcp-publisher publish
curl -fsS "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.bartekrutkowski/watchgoose"
```

Before publishing, validate `server.json` against the schema URL in its `$schema` field and confirm
the registry remains in preview. A later npm publication requires a separately reviewed `packages`
entry and matching package verification metadata; do not add it speculatively.

## Aggregator payloads

Submit the same canonical facts to mcp.so, PulseMCP, and Glama only after revalidating their current
forms and ingestion APIs. Smithery is blocked pending a live authentication compatibility check: its
current hosted connection flow may require Client ID Metadata Documents, while Watchgoose currently
supports Dynamic Client Registration. Do not claim Smithery compatibility or submit there unless
Smithery confirms DCR support or a separately reviewed CIMD implementation lands.

| Directory | Status                            | Name or slug                | Endpoint                         | Auth              |
| --------- | --------------------------------- | --------------------------- | -------------------------------- | ----------------- |
| mcp.so    | Prepared; revalidate form         | `Watchgoose` / `watchgoose` | `https://mcp.watchgoose.com/mcp` | OAuth 2.1 + DCR   |
| Smithery  | Blocked on DCR/CIMD compatibility | `Watchgoose` / `watchgoose` | `https://mcp.watchgoose.com/mcp` | Do not submit yet |
| PulseMCP  | Prepared; revalidate form         | `Watchgoose` / `watchgoose` | `https://mcp.watchgoose.com/mcp` | OAuth 2.1 + DCR   |
| Glama     | Prepared; revalidate form         | `Watchgoose` / `watchgoose` | `https://mcp.watchgoose.com/mcp` | OAuth 2.1 + DCR   |

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
7. Submit to Claude first, then the official MCP Registry and selected aggregators.
8. Record every accepted, rejected, or pending listing in the canonical owner workbook.
9. Apply no DNS-AID MCP record unless revalidation resolves the draft and registration blockers.
