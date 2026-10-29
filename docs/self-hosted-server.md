# Self-hosted server architecture and evidence

This document records T-152 implementation evidence. It is not a deployment record. DNS, container
secrets, production wiring, and deployment remain owner-run.

## Stage 0 dependency decision

The server uses these exact production versions:

- `oidc-provider` `9.11.5`
- `@modelcontextprotocol/server` `2.0.0`, matching `packages/core`
- `better-sqlite3` `12.4.1`

Type packages are also exact: `@types/oidc-provider` `9.11.1`, `@types/better-sqlite3` `9.6.0`, and
`@types/node` `24.10.1`. `better-sqlite3` 12.4.1 declares support for Node 20, 22, 23, and 24; v13
requires Node 22 or later, so 12.4.1 preserves the repository's Node 20 core/stdio path. Production
uses Node 24.

Evidence reviewed on 2026-08-27:

- The
  [oidc-provider 9.11.5 authorization-code handler](https://github.com/panva/node-oidc-provider/blob/v9.11.5/lib/actions/grants/authorization_code.js)
  verifies PKCE before consuming the code and before token issuance. Its
  [PKCE helper](https://github.com/panva/node-oidc-provider/blob/v9.11.5/lib/helpers/pkce.js)
  accepts only S256. Watchgoose additionally requires PKCE for every client and its SQLite adapter
  makes `consume()` a conditional atomic update.
- `oidc-provider` implements RFC 7591 DCR, authorization code and refresh grants, and RFC 8707
  resource indicators. The configuration disables unrelated grant types and features.
- `@node-oauth/oauth2-server` is disqualified by
  [GHSA-jhm7-29pj-4xvf](https://github.com/advisories/GHSA-jhm7-29pj-4xvf), an authorization-code
  PKCE bypass. Advisory history in this area is treated as disqualifying even if a downstream
  configuration could compensate.
- [`oauth4webapi`](https://github.com/panva/oauth4webapi) is an OAuth/OIDC client and relying-party
  implementation, not an authorization server, so it cannot own DCR and token issuance.
- `@cloudflare/workers-oauth-provider` no longer applies: the amended architecture is a regional
  Node service with service-owned SQLite backup and retention, not a Cloudflare Worker or KV
  deployment.
- `npm audit --audit-level=low` reported zero vulnerabilities for the installed lockfile on
  2026-08-27. Re-run it and repeat the source/advisory review before dependency updates.

Package integrity values are locked in `package-lock.json`. The npm registry integrity for
`oidc-provider` 9.11.5 is
`sha512-Q8pqzhtQd42NyUjgxpWqwqX50/YPJ2i1YmhxSEYGYiZit7C1FRG/8RnnSetGzsj5sTuOC4bQbnUeqmmUM1j1fw==`;
for `better-sqlite3` 12.4.1 it is
`sha512-3yVdyZhklTiNrtg+4WqHpJpFDd+WHTg2oM7UcR80GqL05AOV0xEJzc6qNvFYoEtE+hRp1n9MpN6/+4yhlGkDXQ==`.

## Runtime boundaries

- The issuer is `https://mcp.watchgoose.com`; the only resource and access-token audience is
  `https://mcp.watchgoose.com/mcp`.
- The public router allowlists exact paths. `/mcp` accepts POST only, all responses use
  `Cache-Control: no-store`, and subscriptions and SSE operations are rejected.
- Each MCP POST constructs and closes a fresh MCP server and single-use stateless transport. Modern
  requests use the SDK's v2 per-request handler; responses are accepted only when JSON. Legacy
  requests use a fresh stateless JSON transport.
- Authorization always forces a fresh consent interaction, including requests without
  `offline_access`; an existing provider session cannot silently mint another origin credential.
- Every authorization-code grant issues a refresh token when the client registered the
  `refresh_token` grant, whether or not it requested `offline_access`. ChatGPT requests only
  `mcp:read mcp:write`; without this its connection ended with the one-hour access token. As the MCP
  authorization spec recommends, `offline_access` stays out of the protected-resource
  `scopes_supported` and the `WWW-Authenticate` challenge, and the authorization server metadata
  still lists it.
- Connection lifetime is rolling. Each successful refresh moves the grant and its encrypted
  credential to 30 days from that refresh, capped at one year after sign-in (`REFRESH_TOKEN_TTL`,
  `MAX_GRANT_LIFETIME`). Rotated refresh tokens never outlive the cap. A grant that isn't refreshed
  for 30 days, or reaches one year, ends: its refresh tokens are rejected and its unexpired access
  tokens stop working, so the client signs in again.
- The refresh also extends the client registration to at least the grant's new expiry. A
  registration is shared by every grant of that client and expires only after the last of them, so
  it can outlive an individual grant. A client re-registers only when its registration itself has
  expired; otherwise it signs in again with the same `client_id`.
- Refresh tokens rotate on every use. A rotated token is accepted again for 10 minutes
  (`REFRESH_TOKEN_REUSE_INTERVAL`), so a lost token response or two concurrent refreshes don't end
  the connection; each reuse issues another token from the same grant. Reuse after that interval is
  treated as theft: oidc-provider revokes the grant and every token and credential derived from it.
- The interaction and session cookies use `__Host-`. The provider intentionally scopes its resume
  cookie to `/authorize/<uid>`, which is incompatible with the required `Path=/` for `__Host-`, so
  resume uses `__Secure-`. Its HMAC-SHA1 signature matches oidc-provider 9.11.5's Keygrip format;
  HMAC-SHA1 is not used for tokens, storage, encryption, or account identifiers.
- The external interaction bridge passes T-151's exact callback, client, state, scope, and PKCE
  parameters. `/oauth/callback` atomically consumes local state before exchanging the handoff.
  Django's returned client and effective scope must match the provider transaction. The
  authenticated exchange uses `http://web:8000/mcp/handoff/exchange/`. The connect URL also carries
  `expires_at`, described under "Authorization deadline" below.
- The `hcm_` key is encrypted with AES-256-GCM before persistence. A labeled encryption subkey is
  derived from the root in `MCP_STATE_ENCRYPTION_KEY_FILE`; the root is never used directly as an
  AES key. The Django exchange bearer is read from `MCP_WORKER_SECRET_FILE`, while private pruning
  uses a separate `MCP_MAINTENANCE_SECRET_FILE`. Access tokens never contain the origin key.
- Every MCP request validates the opaque token, expiry, client, grant, audience, and effective
  scopes, then decrypts the grant credential. Origin requests are made only through `packages/core`,
  whose header allowlist and output sanitizer are shared with stdio. An origin 401 replaces that
  call's response with OAuth 401 and removes the local grant artifacts.
- The service has no telemetry or duplicate rate limiter. It writes structured JSON log lines to
  stdout, described under "Logs" below.

## Authorization deadline

One authorization has 30 minutes (`TRANSIENT_TTL`, 1800 seconds) from the moment the client is sent
to `/authorize` until Django redirects back to `/oauth/callback`. The pending bridge state, the
oidc-provider Interaction and its cookies, and the provider Session all use this TTL. Django allows
the same 30 minutes for its side, which covers waiting for an emailed approval code (15 minutes).
`AUTHORIZATION_CODE_TTL` stays at 60 seconds and the access and refresh token TTLs are unchanged.

The redirect to the Django connect page includes `expires_at`: the absolute Unix time in integer
seconds at which this authorization stops being accepted. It is the earlier of the pending state's
expiry and the provider Interaction's expiry, so in practice the start time plus 1800. The
authorization can complete while the current time is before `expires_at`; at or after it the
callback is rejected. Django uses the earlier of its own 30 minute limit and `expires_at` and never
extends past it. The value only shortens Django's window, so it is not signed.

When the pending state or the interaction is gone (expired, already used, or opened in another
browser), `/oauth/callback` answers 400 with a small HTML page titled "This connection request has
expired" that says the link expired or was already used. When the bridge fails unexpectedly it
answers 500 with "Connection failed". Both pages tell the user to go back to their AI assistant and
start connecting Watchgoose again, link to the MCP setup guide, and use `Cache-Control: no-store`
with a restrictive Content Security Policy. They never redirect to the client: once the pending
state is consumed or gone there is no trustworthy client and state to redirect with, and the handoff
code is never exchanged.

## Logs

The service writes one JSON object per line on stdout; Docker keeps and rotates them. Every line has
`ts` (ISO 8601), `level` (`info`, `warn` or `error`) and `event`. A line written while handling a
request also has `request_id` when the request carried an `X-Request-ID` header matching
`[A-Za-z0-9-]{1,64}` (Caddy adds one); any other value is ignored.

Logs never contain access, refresh or authorization codes, handoff codes, state ids, client secrets,
`Authorization` headers, cookies, email addresses, IP addresses, raw query strings, request or
response bodies, decrypted credentials or account ids. Flows are linked with `interaction_ref` and
`grant_ref`, the first 12 hex characters of an HMAC SHA256 of the interaction uid or grant id under
a key derived from `MCP_STATE_ENCRYPTION_KEY_FILE`. Clients are named by `client_name`, the
registered DCR name cut to 60 characters, or by `client_family`, the first User Agent token cut to
40 characters. Email and IPv4 lookalikes in either are replaced with `[redacted]`.

| Event                               | Fields                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server_started`                    | `version`, `transient_ttl_s`, `authorization_code_ttl_s`, `access_token_ttl_s`, `refresh_token_ttl_s`, `max_grant_lifetime_s`, and the hosts only of the issuer, callback, connect, handoff and API URLs                                                                                                                                                                           |
| `server_stopping`, `startup_failed` | `startup_failed` adds `error_name`                                                                                                                                                                                                                                                                                                                                                 |
| `http_request`                      | `method`, `route` (`mcp`, `oauth_authorize`, `oauth_token`, `oauth_register`, `oauth_discovery`, `oauth_callback`, `health` or `other`), `status`, `duration_ms`, `client_family`, `client_name` when known, `aborted` when the connection closed first                                                                                                                            |
| `mcp_auth_rejected`                 | `reason` (`no_token`, `malformed`, `unknown_or_expired_token`, `no_credential`, `insufficient_scope`, or `origin_unauthorized` when Django answered 401 for the stored credential), `client_name` or `client_family`, `grant_ref` when known                                                                                                                                       |
| `oauth_interaction_started`         | `interaction_ref`, `client_name`, `expires_at`                                                                                                                                                                                                                                                                                                                                     |
| `oauth_begin`                       | `result` (`ok`, `expired` or `error`), `reason`, `interaction_ref`, `client_name`, `expires_at`                                                                                                                                                                                                                                                                                    |
| `oauth_complete`                    | `result` (`ok`, `expired`, `denied`, `handoff_exchange_failed`, `binding_failed` or `error`), `reason` (for example `pending_missing`, `interaction_missing`, `missing_state`, `network`, `http_status`, `too_large`, `invalid_response`, `grant_storage`), `upstream_status`, `interaction_ref`, `grant_ref`, `client_name`, `access`, `duration_s` since the interaction started |
| `oauth_grant_issued`                | `grant_ref`, `client_name`, `refresh_token_issued` (`true` or `false`), `scope`, `flow_duration_s` from interaction start to token issue when known                                                                                                                                                                                                                                |
| `oidc_error`                        | `oidc_event` (`server_error`, `authorization.error`, `grant.error`, `registration_create.error` or `backchannel.error`), `error_name`, `error`, `error_description` cut to 200 characters, `client_name`                                                                                                                                                                           |
| `oidc_refresh_token_consumed`       | none, one line per refresh                                                                                                                                                                                                                                                                                                                                                         |
| `oidc_grant_revoked`                | `grant_ref`                                                                                                                                                                                                                                                                                                                                                                        |
| `request_failed`                    | none, an unexpected error escaped a route                                                                                                                                                                                                                                                                                                                                          |

## SQLite operations

SQLite has exactly three physical tables: `dcr_clients`, `refresh_grants`, and
`authorization_codes`. Model discriminators let provider Grant, RefreshToken, and AccessToken rows
share `refresh_grants`; AuthorizationCode, Interaction, Session, and short-lived bridge state share
`authorization_codes`. Every provider payload is encrypted with AES-256-GCM and every row
identifier, grant reference, and interaction UID is HMAC-derived, so a volume snapshot does not
expose access, refresh, authorization-code, session, or origin credentials. Unsupported provider
artifact types are rejected. WAL mode and a five-second busy timeout are enabled; parent directories
and database/backup files use modes 0700 and 0600.

DCR clients, transient authorization state, and refresh/grant artifacts have fixed row ceilings.
Expired rows are pruned before capacity checks, and `/token` rejects new work before the provider
can consume a code or refresh token when there is not room for the resulting artifacts.

The commercial cron container invokes a private, bearer-authenticated `POST /internal/prune` over
the Compose network once daily. Caddy returns 404 for `/internal/*`; the route is not public. The
same bounded 10,000-row operation is available to operators:

```shell
node packages/server/dist/cli.js prune --limit 10000
```

Create a consistent online SQLite backup with the `better-sqlite3` backup API:

```shell
node packages/server/dist/cli.js backup --output /backup/watchgoose-mcp.sqlite
```

The `/data` volume and its backups contain encrypted refresh credential material that can stay valid
for up to one year and should use the production database retention and access policy. The container
receives no PostgreSQL credentials or Django settings.

## Production configuration

Required file-backed secrets:

- `MCP_WORKER_SECRET_FILE`: T-151 handoff exchange bearer secret
- `MCP_MAINTENANCE_SECRET_FILE`: private prune bearer secret
- `MCP_STATE_ENCRYPTION_KEY_FILE`: exactly 32 bytes encoded as 64 hex characters or canonical base64

Optional settings are `MCP_HOST` (default `0.0.0.0`), `MCP_PORT` (default `8080`), and
`MCP_STATE_DATABASE` (default `/data/oauth.sqlite`). Set `OPENAI_APPS_CHALLENGE_TOKEN` only while
OpenAI needs to verify the MCP host; the corresponding well-known endpoint returns 404 when it is
unset. Production startup fixes and validates all issuer, resource, callback, consent, handoff, API,
and documentation URLs to their canonical HTTPS values, except the handoff exchange which is fixed
to the private `http://web:8000` Compose service. `/healthz` checks listener and SQLite readiness
and returns no configuration or secrets.

Production is pinned to Node 24 because `better-sqlite3` is native. Do not share `node_modules`
between Node majors. Rebuild the pinned image or run `npm ci` under Node 24 when a binding or
`NODE_MODULE_VERSION` error appears.

## External verification remaining

Live Claude.ai DCR/consent/tool execution, Claude Code loopback OAuth, production revocation, and
reconnect verification require the owner-run T-151 deployment, DNS, secrets, container wiring, and
deployment. Do not record cookies, handoff codes, access/refresh tokens, API keys, or origin
identifiers in that evidence.
