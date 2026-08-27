import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENT_REGISTRATION_TTL, MAX_REFRESH_ROWS } from "./constants.js";
import { SqliteState } from "./database.js";

const KEY = Buffer.alloc(32, 7);

describe("SQLite OAuth state", () => {
  it("creates exactly three physical tables and encrypts hcm credentials", () => {
    const state = new SqliteState(":memory:", KEY, () => 100);
    state.storeCredential("grant", { apiKey: `hcm_${"s".repeat(28)}`, access: "read-only" }, 200);
    expect(state.physicalTables()).toEqual([
      "authorization_codes",
      "dcr_clients",
      "refresh_grants",
    ]);
    const stored = state.db
      .prepare(
        "SELECT payload, ciphertext, nonce, tag FROM refresh_grants WHERE model='Credential'"
      )
      .get() as Record<string, unknown>;
    expect(JSON.stringify(stored)).not.toContain("hcm_");
    expect(stored.payload).toBe("{}");
    expect(stored.payload).not.toContain("hcm_");
    expect(stored.ciphertext).toBeInstanceOf(Buffer);
    expect(stored.nonce).toBeInstanceOf(Buffer);
    expect(stored.tag).toBeInstanceOf(Buffer);
    expect(state.loadCredential("grant")).toEqual({
      apiKey: `hcm_${"s".repeat(28)}`,
      access: "read-only",
    });
    state.close();
  });

  it("allows exactly one concurrent authorization-code consumption", async () => {
    const state = new SqliteState(":memory:", KEY, () => 100);
    const adapter = state.adapter("AuthorizationCode");
    await adapter.upsert(
      "code",
      { kind: "AuthorizationCode", exp: 200, clientId: "client", grantId: "grant" },
      100
    );
    expect(
      JSON.stringify(state.db.prepare("SELECT id, payload FROM authorization_codes").get())
    ).not.toContain("code");
    const results = await Promise.allSettled([adapter.consume("code"), adapter.consume("code")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await adapter.find("code"))?.consumed).toBe(100);
    state.close();
  });

  it("does not return expired access or refresh artifacts", async () => {
    let now = 100;
    const state = new SqliteState(":memory:", KEY, () => now);
    const access = state.adapter("AccessToken");
    const refresh = state.adapter("RefreshToken");
    await access.upsert("access", { kind: "AccessToken", exp: 101 }, 1);
    await refresh.upsert("refresh", { kind: "RefreshToken", exp: 101 }, 1);
    expect(await access.find("access")).toBeTruthy();
    expect(await refresh.find("refresh")).toBeTruthy();
    now = 101;
    expect(await access.find("access")).toBeUndefined();
    expect(await refresh.find("refresh")).toBeUndefined();
    state.close();
  });

  it("extends a DCR client through the refresh grant lifetime", async () => {
    let now = 100;
    const state = new SqliteState(":memory:", KEY, () => now);
    const clients = state.adapter("Client");
    await clients.upsert("client", {
      client_id: "client",
      client_name: "Claude Code",
      redirect_uris: ["http://127.0.0.1:49152/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    const grantExpiresAt = 100 + CLIENT_REGISTRATION_TTL + 100;
    state.touchClient("client", grantExpiresAt);
    now = grantExpiresAt - 1;
    expect(await clients.find("client")).toBeTruthy();
    now = grantExpiresAt;
    expect(await clients.find("client")).toBeUndefined();
    state.close();
  });

  it("bounds refresh state before a token can be consumed", () => {
    const state = new SqliteState(":memory:", KEY, () => 100);
    state.db.exec(`
      WITH RECURSIVE rows(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM rows WHERE value < ${MAX_REFRESH_ROWS}
      )
      INSERT INTO refresh_grants (id, model, payload, expires_at)
      SELECT printf('row-%06d', value), 'CapacityTest', '{}', 200 FROM rows
    `);
    expect(state.hasRefreshCapacity(1)).toBe(false);
    state.db.prepare("UPDATE refresh_grants SET expires_at=99 WHERE id='row-000001'").run();
    expect(state.hasRefreshCapacity(1)).toBe(true);
    state.close();
  });

  it("prunes bounded rows and makes a consistent online backup", async () => {
    let now = 100;
    const directory = mkdtempSync(join(tmpdir(), "watchgoose-mcp-state-"));
    const database = join(directory, "state.sqlite");
    const backup = join(directory, "backup.sqlite");
    const state = new SqliteState(database, KEY, () => now);
    const adapter = state.adapter("Interaction");
    await adapter.upsert("one", { kind: "Interaction", exp: 101 }, 1);
    await adapter.upsert("two", { kind: "Interaction", exp: 101 }, 1);
    now = 102;
    expect(state.prune(1)).toBe(1);
    expect(state.db.prepare("SELECT COUNT(*) AS count FROM authorization_codes").get()).toEqual({
      count: 1,
    });
    await state.backup(backup);
    const copy = new SqliteState(backup, KEY, () => now);
    expect(copy.physicalTables()).toEqual(state.physicalTables());
    expect(copy.db.prepare("SELECT COUNT(*) AS count FROM authorization_codes").get()).toEqual({
      count: 1,
    });
    expect(statSync(database).mode & 0o777).toBe(0o600);
    expect(statSync(backup).mode & 0o777).toBe(0o600);
    expect(readFileSync(backup).length).toBeGreaterThan(0);
    copy.close();
    state.close();
  });

  it("rejects persistence for unsupported provider artifacts", () => {
    const state = new SqliteState(":memory:", KEY);
    expect(() => state.adapter("DeviceCode")).toThrow("unsupported oidc-provider model");
    expect(() => state.adapter("RegistrationAccessToken")).toThrow(
      "unsupported oidc-provider model"
    );
    state.close();
  });
});
