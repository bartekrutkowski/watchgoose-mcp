import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runJob(
  jobStatus: number,
  curlStatus: number,
  configured: boolean | "empty" = true,
  command?: string[]
) {
  const doc = readFileSync("skills/watchgoose-monitor-scheduled-job/instrumentation.md", "utf8");
  const shell = doc.match(/```sh\n([\s\S]*?)\n```/)?.[1];
  expect(shell, "the referenced draft must include a runnable POSIX shell example").toBeTruthy();
  const dir = mkdtempSync(join(tmpdir(), "watchgoose-wrapper-"));
  dirs.push(dir);
  const script = join(dir, "wrapper.sh");
  const events = join(dir, "events");
  writeFileSync(script, shell!);
  // Substitute the external operation, not the wrapper's status/control flow.
  writeFileSync(
    join(dir, "curl"),
    `#!/bin/sh
post=false; bounded=false; fail=false; previous=''
for arg do
  case "$arg" in --fail) fail=true;; esac
  if [ "$previous" = --request ] && [ "$arg" = POST ]; then post=true; fi
  if [ "$previous" = --max-time ] && [ "$arg" = 10 ]; then bounded=true; fi
  previous="$arg"; url="$arg"
done
if ! $post || ! $bounded || ! $fail; then exit 79; fi
case "$url" in */fail) kind=fail;; *) kind=success;; esac
printf "%s\\n" "$kind" >> "$EVENTS"
if [ "$CURL_STATUS" -ne 0 ]; then printf '%s\\n' "$url" >&2; fi
exit "$CURL_STATUS"
`,
    { mode: 0o700 }
  );
  execFileSync("sh", ["-n", script]);
  const result = spawnSync(
    "sh",
    [script, ...(command ?? ["sh", "-c", `printf '%s\\n' job-ran; exit ${jobStatus}`])],
    {
      encoding: "utf8",
      env: {
        PATH: `${dir}:/usr/bin:/bin`,
        EVENTS: events,
        CURL_STATUS: String(curlStatus),
        ...(configured === "empty"
          ? { WATCHGOOSE_PING_URL: "" }
          : configured
            ? { WATCHGOOSE_PING_URL: "https://example.invalid/private-canary" }
            : {}),
      },
    }
  );
  let notifications: string[] = [];
  try {
    notifications = readFileSync(events, "utf8").trim().split("\n");
  } catch {
    // No notification is expected without a configured URL or job command.
  }
  return { ...result, notifications };
}

describe("draft heartbeat wrapper", () => {
  it.each([0, 7])("preserves job failure even when curl exits %i", (curlStatus) => {
    const result = runJob(23, curlStatus);
    expect(result.status).toBe(23);
    expect(result.notifications).toEqual(["fail"]);
    expect(result.stderr).not.toContain("private-canary");
    if (curlStatus === 0) expect(result.stderr).toBe("");
    else expect(result.stderr).toContain("heartbeat request failed");
  });

  it.each([0, 7])(
    "reports success only after a successful job when curl exits %i",
    (curlStatus) => {
      const result = runJob(0, curlStatus);
      expect(result.status).toBe(0);
      expect(result.notifications).toEqual(["success"]);
      expect(result.stderr).not.toContain("private-canary");
      if (curlStatus === 0) expect(result.stderr).toBe("");
      else expect(result.stderr).toContain("heartbeat request failed");
    }
  );

  it("keeps the wrapper's private ping configuration out of the job environment", () => {
    const result = runJob(0, 0, true, ["sh", "-c", 'printf "%s" "${WATCHGOOSE_PING_URL:-}"']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.notifications).toEqual(["success"]);
  });

  it.each([true, false, "empty"] as const)(
    "rejects a missing command with configuration %s",
    (configured) => {
      const result = runJob(0, 0, configured, []);
      expect(result.status).toBe(64);
      expect(result.stdout).toBe("");
      expect(result.notifications).toEqual([]);
    }
  );

  describe.each([
    { label: "unset", configured: false },
    { label: "empty", configured: "empty" },
  ] as const)("with $label private configuration", ({ configured }) => {
    it.each([0, 23])("runs the job and preserves exit %i without notifying", (jobStatus) => {
      const result = runJob(jobStatus, 0, configured);
      expect(result.stdout).toBe("job-ran\n");
      expect(result.status).toBe(jobStatus);
      expect(result.notifications).toEqual([]);
      expect(result.stderr).toBe(
        "Watchgoose heartbeat URL is not configured; job ran without notification.\n"
      );
      expect(result.stderr).not.toContain("private-canary");
    });
  });
});
