# Production verification

Run this checklist from the reviewed T-109 commit on `main`. Use a dedicated Watchgoose test project
with no customer checks or integrations. Do not paste API keys, ping URLs, Terraform state, or raw
command output into tickets or public logs.

## 1. Create test credentials

In Watchgoose **Project settings**, create both of these keys for the same dedicated project:

- one `hcw_` read-write API key
- one `hcr_` read-only API key

Load them without echoing them or writing them inside the repository:

```shell
read -rsp "Read-write API key: " WATCHGOOSE_TEST_RW_API_KEY && printf '\n'
read -rsp "Read-only API key: " WATCHGOOSE_TEST_RO_API_KEY && printf '\n'
export WATCHGOOSE_TEST_RW_API_KEY WATCHGOOSE_TEST_RO_API_KEY
export WATCHGOOSE_INTEGRATION=1
```

Confirm only that the variables are present:

```shell
test -n "$WATCHGOOSE_TEST_RW_API_KEY"
test -n "$WATCHGOOSE_TEST_RO_API_KEY"
```

## 2. Run the production integration suite

From the repository root:

```shell
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
WATCHGOOSE_INTEGRATION=1 npm run test:integration
```

The integration suite performs this disposable-project sequence:

1. Connect with the read-write key and verify all ten tools are listed.
2. Create and update a check.
3. List and get the check.
4. Pause and resume it.
5. Send start, success, failure, and success signals.
6. Verify sanitized pings, flips, and integrations.
7. Delete the check.
8. Connect with the read-only key and verify that only `list_checks`, `get_check`, and `list_flips`
   are listed.
9. Verify the API rejects the read-only key on the integrations endpoint.

The suite has a final cleanup fallback, but confirm in the dashboard that no `MCP integration ...`
check remains.

Record the test count, exit status, UTC timestamp, and key prefixes only. Do not record complete
keys, check UUIDs, unique keys, or ping URLs.

## 3. Exercise a real 429 response

Run this only against the disposable project. It sends at most 250 list requests and stops at the
first rate-limit response:

```shell
WATCHGOOSE_INTEGRATION=1 WATCHGOOSE_TEST_429=1 \
  npx vitest run --config vitest.integration.config.ts -t "maps a live 429 response"
```

The test passes only when the MCP result tells the client to back off. It also checks the live 429
response for `Retry-After`; when present, the MCP result must include the delay clamped to the
server's supported 1-3600 second guidance range. Wait for the project's API quota to recover before
further verification.

## 4. Verify the community Terraform provider

This test uses community provider `kristofferahl/healthchecksio` v2.3.0. It performs remote reads
with the read-write key; it must not run `terraform apply` or `terraform destroy`.

Create one disposable check in Watchgoose and note its UUID privately. In a temporary directory
outside this repository, create this configuration:

```hcl
terraform {
  required_providers {
    healthchecksio = {
      source  = "kristofferahl/healthchecksio"
      version = "2.3.0"
    }
  }
}

variable "api_key" {
  type      = string
  sensitive = true
}

provider "healthchecksio" {
  api_key = var.api_key
  api_url = "https://watchgoose.com/api/v3"
}

resource "healthchecksio_check" "probe" {
  name    = "Terraform compatibility probe"
  timeout = 300
  grace   = 60
}
```

Then run:

```shell
export TF_VAR_api_key="$WATCHGOOSE_TEST_RW_API_KEY"
terraform init
terraform import healthchecksio_check.probe THE_PRIVATE_CHECK_UUID
terraform state show healthchecksio_check.probe >/dev/null
terraform plan -refresh-only
```

An import and refresh that read the Watchgoose check successfully establish the compatibility
verdict required by T-109 without changing the remote check. A refresh plan may show local state or
configuration drift; do not apply it. Delete the probe from the Watchgoose dashboard, then securely
remove the temporary directory and its state.

The provider is not compatible with an `hcr_` key: v2.3.0 derives each resource ID from
`update_url`, which the Watchgoose read-only response intentionally omits, and its channel data
source calls an endpoint outside the read-only-key surface. Record this limitation with the positive
read-write-key verdict. Do not describe the provider as official.

## 5. Verify the published package in Claude Desktop

After owner review, commit, push, green CI, and owner-run npm publication, use this Claude Desktop
entry:

```json
{
  "mcpServers": {
    "watchgoose": {
      "command": "npx",
      "args": ["-y", "watchgoose-mcp"],
      "env": {
        "WATCHGOOSE_API_KEY": "hcw_replace_with_the_test_key",
        "WATCHGOOSE_ENABLE_WRITES": "true"
      }
    }
  }
}
```

Restart Claude Desktop and ask it to:

1. List checks.
2. Create a check named `Claude Desktop MCP verification` with a 300-second timeout and 60-second
   grace period.
3. Pause the returned check.
4. Resume it.
5. Delete it after explicit confirmation.

Capture a redacted transcript or screenshots showing the five tool names and successful outcomes.
Remove API keys, check identifiers, and URLs from evidence. Repeat with the `hcr_` key and confirm
Claude Desktop sees exactly three tools and no mutation tools.

## 6. Publish and CI owner checklist

The owner performs every external state change:

1. Create the public `bartekrutkowski/watchgoose-mcp` repository.
2. Add it as this checkout's `origin` and push the reviewed `main` branch.
3. Enable branch protection and confirm GitHub Actions passes format, lint, typecheck, tests, build,
   and package dry-run on Node 20 and Node 24.
4. Run `npm publish --dry-run --workspace watchgoose-mcp` once more from a clean checkout.
5. Run `npm publish --workspace watchgoose-mcp` as the owner.
6. Verify `npm view watchgoose-mcp version` and start a fresh `npx -y watchgoose-mcp` connection.
7. Revoke both test keys and delete the dedicated test project.

Registry submissions, hosted Worker deployment, and the public `/docs/mcp/` page are T-152/T-153
work and are not part of this checklist.
