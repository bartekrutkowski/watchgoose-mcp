import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { errors, type Adapter, type AdapterPayload, type ClientMetadata } from "oidc-provider";
import {
  CLIENT_REGISTRATION_TTL,
  MAX_DCR_CLIENTS,
  MAX_REFRESH_ROWS,
  MAX_TRANSIENT_ROWS,
} from "./constants.js";
import { decrypt, deriveKey, encrypt, storageKey } from "./crypto.js";
import { validateClientMetadata } from "./security.js";

type Table = "dcr_clients" | "refresh_grants" | "authorization_codes";

const MODEL_TABLE: Readonly<Record<string, Table>> = {
  Client: "dcr_clients",
  Grant: "refresh_grants",
  RefreshToken: "refresh_grants",
  AccessToken: "refresh_grants",
  AuthorizationCode: "authorization_codes",
  Interaction: "authorization_codes",
  Session: "authorization_codes",
};

export interface StoredCredential {
  apiKey: string;
  access: "read-only" | "read-write";
}

export interface PendingAuthorization {
  interactionUid: string;
}

interface GenericRow {
  id: string;
  payload: string;
  expires_at: number | null;
  consumed_at: number | null;
  ciphertext: Buffer | null;
  nonce: Buffer | null;
  tag: Buffer | null;
}

interface EncryptedPayload {
  ciphertext: string;
  nonce: string;
  tag: string;
  version: 1;
}

export class SqliteState {
  readonly db: Database.Database;
  private readonly stateEncryptionKey: Buffer;

  constructor(
    path: string,
    private readonly encryptionKey: Buffer,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000)
  ) {
    this.stateEncryptionKey = deriveKey(encryptionKey, "sqlite-state-encryption");
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      chmodSync(dirname(path), 0o700);
    }
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dcr_clients (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        expires_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS refresh_grants (
        id TEXT NOT NULL,
        model TEXT NOT NULL,
        payload TEXT NOT NULL,
        expires_at INTEGER,
        consumed_at INTEGER,
        grant_id TEXT,
        ciphertext BLOB,
        nonce BLOB,
        tag BLOB,
        PRIMARY KEY (id, model)
      );
      CREATE INDEX IF NOT EXISTS refresh_grants_grant_id
        ON refresh_grants(grant_id);
      CREATE TABLE IF NOT EXISTS authorization_codes (
        id TEXT NOT NULL,
        model TEXT NOT NULL,
        payload TEXT NOT NULL,
        expires_at INTEGER,
        consumed_at INTEGER,
        grant_id TEXT,
        uid TEXT,
        PRIMARY KEY (id, model)
      );
      CREATE INDEX IF NOT EXISTS authorization_codes_grant_id
        ON authorization_codes(grant_id);
      CREATE INDEX IF NOT EXISTS authorization_codes_uid
        ON authorization_codes(uid, model);
    `);
    if (path !== ":memory:") {
      for (const file of [path, `${path}-shm`, `${path}-wal`]) {
        if (existsSync(file)) chmodSync(file, 0o600);
      }
    }
  }

  adapter(model: string): Adapter {
    const table = MODEL_TABLE[model];
    if (!table) throw new Error(`unsupported oidc-provider model: ${model}`);
    return {
      upsert: async (id, payload, expiresIn) => this.upsert(table, model, id, payload, expiresIn),
      find: async (id) => this.find(table, model, id),
      async findByUserCode() {
        return undefined;
      },
      findByUid: async (uid) => this.findByUid(table, model, uid),
      consume: async (id) => this.consume(table, model, id),
      destroy: async (id) => this.destroy(table, model, id),
      revokeByGrantId: async (grantId) => this.invalidateGrant(grantId),
    };
  }

  private upsert(
    table: Table,
    model: string,
    id: string,
    payload: AdapterPayload,
    expiresIn?: number
  ): void {
    if (model === "Client") {
      try {
        validateClientMetadata(payload as ClientMetadata);
      } catch {
        throw new errors.InvalidClientMetadata("client metadata does not satisfy server policy");
      }
    }
    const expiresAt =
      expiresIn === undefined
        ? typeof payload.exp === "number"
          ? payload.exp
          : model === "Client"
            ? this.now() + CLIENT_REGISTRATION_TTL
            : null
        : this.now() + expiresIn;
    const storedId = storageKey(model, id, this.encryptionKey);
    const serialized = this.serializePayload(table, model, storedId, payload);
    this.ensureCapacity(table, model, storedId);
    if (table === "dcr_clients") {
      this.db
        .prepare(
          `INSERT INTO dcr_clients (id, payload, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, expires_at=excluded.expires_at`
        )
        .run(storedId, serialized, expiresAt);
      return;
    }
    const uid =
      typeof payload.uid === "string"
        ? storageKey(`${model}:uid`, payload.uid, this.encryptionKey)
        : null;
    this.db
      .prepare(
        `INSERT INTO ${table} (id, model, payload, expires_at, consumed_at, grant_id${table === "authorization_codes" ? ", uid" : ""})
         VALUES (?, ?, ?, ?, NULL, ?${table === "authorization_codes" ? ", ?" : ""})
         ON CONFLICT(id, model) DO UPDATE SET
           payload=excluded.payload, expires_at=excluded.expires_at,
           grant_id=excluded.grant_id${table === "authorization_codes" ? ", uid=excluded.uid" : ""}`
      )
      .run(
        storedId,
        model,
        serialized,
        expiresAt,
        typeof payload.grantId === "string"
          ? storageKey("Grant", payload.grantId, this.encryptionKey)
          : null,
        ...(table === "authorization_codes" ? [uid] : [])
      );
  }

  private ensureCapacity(table: Table, model: string, storedId: string): void {
    if (table === "refresh_grants") {
      if (!this.hasRefreshCapacity(1, storedId, model)) {
        throw new Error("refresh grant capacity is unavailable");
      }
      return;
    }
    if (table !== "dcr_clients" && table !== "authorization_codes") return;
    this.db
      .prepare(
        `DELETE FROM ${table} WHERE rowid IN
         (SELECT rowid FROM ${table} WHERE expires_at IS NOT NULL AND expires_at<=? LIMIT 100)`
      )
      .run(this.now());
    const exists =
      table === "dcr_clients"
        ? this.db.prepare("SELECT 1 FROM dcr_clients WHERE id=?").get(storedId)
        : this.db
            .prepare("SELECT 1 FROM authorization_codes WHERE id=? AND model=?")
            .get(storedId, model);
    if (exists) return;
    const count = (
      this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
    ).count;
    const limit = table === "dcr_clients" ? MAX_DCR_CLIENTS : MAX_TRANSIENT_ROWS;
    if (count >= limit) {
      if (table === "dcr_clients") {
        throw new errors.InvalidClientMetadata("client registration capacity is unavailable");
      }
      throw new Error("transient OAuth state capacity is unavailable");
    }
  }

  hasRefreshCapacity(requiredRows: number, storedId?: string, model?: string): boolean {
    if (
      !Number.isSafeInteger(requiredRows) ||
      requiredRows < 1 ||
      requiredRows > MAX_REFRESH_ROWS
    ) {
      return false;
    }
    this.db
      .prepare(
        `DELETE FROM refresh_grants WHERE rowid IN
         (SELECT rowid FROM refresh_grants
          WHERE expires_at IS NOT NULL AND expires_at<=? LIMIT 1000)`
      )
      .run(this.now());
    if (
      storedId &&
      model &&
      this.db.prepare("SELECT 1 FROM refresh_grants WHERE id=? AND model=?").get(storedId, model)
    ) {
      return true;
    }
    const count = (
      this.db.prepare("SELECT COUNT(*) AS count FROM refresh_grants").get() as { count: number }
    ).count;
    return count + requiredRows <= MAX_REFRESH_ROWS;
  }

  private find(table: Table, model: string, id: string): AdapterPayload | undefined {
    const row = this.selectRow(table, model, id);
    if (!row || (row.expires_at !== null && row.expires_at <= this.now())) return undefined;
    const payload = this.deserializePayload(table, model, row);
    if (row.consumed_at !== null) payload.consumed = row.consumed_at;
    return payload;
  }

  private selectRow(table: Table, model: string, id: string): GenericRow | undefined {
    const storedId = storageKey(model, id, this.encryptionKey);
    if (table === "dcr_clients") {
      return this.db
        .prepare(
          "SELECT id, payload, expires_at, NULL AS consumed_at, NULL AS ciphertext, NULL AS nonce, NULL AS tag FROM dcr_clients WHERE id=?"
        )
        .get(storedId) as GenericRow | undefined;
    }
    return this.db
      .prepare(
        `SELECT id, payload, expires_at, consumed_at, ${table === "refresh_grants" ? "ciphertext, nonce, tag" : "NULL AS ciphertext, NULL AS nonce, NULL AS tag"}
         FROM ${table} WHERE id=? AND model=?`
      )
      .get(storedId, model) as GenericRow | undefined;
  }

  private serializePayload(
    table: Table,
    model: string,
    storedId: string,
    payload: AdapterPayload
  ): string {
    const aad = Buffer.from(`${table}:${model}:${storedId}`);
    const value = encrypt(JSON.stringify(payload), this.stateEncryptionKey, aad);
    return JSON.stringify({
      version: 1,
      ciphertext: value.ciphertext.toString("base64"),
      nonce: value.nonce.toString("base64"),
      tag: value.tag.toString("base64"),
    } satisfies EncryptedPayload);
  }

  private deserializePayload(table: Table, model: string, row: GenericRow): AdapterPayload {
    const envelope = JSON.parse(row.payload) as Partial<EncryptedPayload>;
    if (
      envelope.version !== 1 ||
      typeof envelope.ciphertext !== "string" ||
      typeof envelope.nonce !== "string" ||
      typeof envelope.tag !== "string"
    ) {
      throw new Error("invalid encrypted OAuth state");
    }
    const plaintext = decrypt(
      {
        ciphertext: Buffer.from(envelope.ciphertext, "base64"),
        nonce: Buffer.from(envelope.nonce, "base64"),
        tag: Buffer.from(envelope.tag, "base64"),
      },
      this.stateEncryptionKey,
      Buffer.from(`${table}:${model}:${row.id}`)
    );
    return JSON.parse(plaintext) as AdapterPayload;
  }

  private findByUid(table: Table, model: string, uid: string): AdapterPayload | undefined {
    if (table !== "authorization_codes" || model !== "Session") return undefined;
    const row = this.db
      .prepare(
        `SELECT id, payload, expires_at, consumed_at,
                NULL AS ciphertext, NULL AS nonce, NULL AS tag
         FROM authorization_codes WHERE model='Session' AND uid=? AND expires_at>?`
      )
      .get(storageKey(`${model}:uid`, uid, this.encryptionKey), this.now()) as
      | GenericRow
      | undefined;
    return row ? this.deserializePayload(table, model, row) : undefined;
  }

  private consume(table: Table, model: string, id: string): void {
    if (table === "dcr_clients") throw new Error("clients are not consumable");
    const result = this.db
      .prepare(
        `UPDATE ${table} SET consumed_at=?
         WHERE id=? AND model=? AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at>?)`
      )
      .run(this.now(), storageKey(model, id, this.encryptionKey), model, this.now());
    if (result.changes !== 1) throw new Error("artifact is already consumed or expired");
  }

  private destroy(table: Table, model: string, id: string): void {
    const storedId = storageKey(model, id, this.encryptionKey);
    if (table === "dcr_clients") {
      this.db.prepare("DELETE FROM dcr_clients WHERE id=?").run(storedId);
    } else {
      this.db.prepare(`DELETE FROM ${table} WHERE id=? AND model=?`).run(storedId, model);
    }
  }

  storeCredential(grantId: string, credential: StoredCredential, expiresAt: number): void {
    const storedId = storageKey("Credential", grantId, this.encryptionKey);
    if (!this.hasRefreshCapacity(1, storedId, "Credential")) {
      throw new Error("refresh grant capacity is unavailable");
    }
    const encrypted = encrypt(
      JSON.stringify(credential),
      this.stateEncryptionKey,
      Buffer.from(`refresh_grants:Credential:${storedId}`)
    );
    this.db
      .prepare(
        `INSERT INTO refresh_grants
           (id, model, payload, expires_at, consumed_at, grant_id, ciphertext, nonce, tag)
         VALUES (?, 'Credential', '{}', ?, NULL, ?, ?, ?, ?)
         ON CONFLICT(id, model) DO UPDATE SET
           expires_at=excluded.expires_at, grant_id=excluded.grant_id,
           ciphertext=excluded.ciphertext, nonce=excluded.nonce, tag=excluded.tag`
      )
      .run(
        storedId,
        expiresAt,
        storageKey("Grant", grantId, this.encryptionKey),
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.tag
      );
  }

  touchClient(clientId: string, expiresAt: number): void {
    const result = this.db
      .prepare(
        `UPDATE dcr_clients SET expires_at = MAX(COALESCE(expires_at, 0), ?)
         WHERE id=?`
      )
      .run(expiresAt, storageKey("Client", clientId, this.encryptionKey));
    if (result.changes !== 1) throw new Error("OAuth client is unavailable");
  }

  loadCredential(grantId: string): StoredCredential | undefined {
    const row = this.selectRow("refresh_grants", "Credential", grantId);
    if (
      !row ||
      row.expires_at === null ||
      row.expires_at <= this.now() ||
      !row.ciphertext ||
      !row.nonce ||
      !row.tag
    ) {
      return undefined;
    }
    const parsed = JSON.parse(
      decrypt(
        { ciphertext: row.ciphertext, nonce: row.nonce, tag: row.tag },
        this.stateEncryptionKey,
        Buffer.from(`refresh_grants:Credential:${row.id}`)
      )
    ) as Partial<StoredCredential>;
    if (
      typeof parsed.apiKey !== "string" ||
      !/^hcm_[A-Za-z0-9]{28}$/.test(parsed.apiKey) ||
      (parsed.access !== "read-only" && parsed.access !== "read-write")
    ) {
      return undefined;
    }
    return parsed as StoredCredential;
  }

  createPending(id: string, pending: PendingAuthorization, ttl: number): void {
    this.upsert("authorization_codes", "Pending", id, pending as unknown as AdapterPayload, ttl);
  }

  findPending(id: string): PendingAuthorization | undefined {
    const row = this.selectRow("authorization_codes", "Pending", id);
    if (
      !row ||
      row.expires_at === null ||
      row.expires_at <= this.now() ||
      row.consumed_at !== null
    ) {
      return undefined;
    }
    return this.deserializePayload(
      "authorization_codes",
      "Pending",
      row
    ) as unknown as PendingAuthorization;
  }

  consumePending(id: string): PendingAuthorization | undefined {
    const transaction = this.db.transaction(() => {
      const pending = this.findPending(id);
      if (!pending) return undefined;
      this.consume("authorization_codes", "Pending", id);
      return pending;
    });
    return transaction();
  }

  invalidateGrant(grantId: string): void {
    const storedGrantId = storageKey("Grant", grantId, this.encryptionKey);
    const transaction = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM refresh_grants WHERE id=? OR grant_id=?")
        .run(storedGrantId, storedGrantId);
      this.db.prepare("DELETE FROM authorization_codes WHERE grant_id=?").run(storedGrantId);
    });
    transaction();
  }

  prune(limit: number): number {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000) {
      throw new Error("prune limit must be from 1 to 100000");
    }
    const transaction = this.db.transaction(() => {
      let removed = 0;
      for (const table of ["dcr_clients", "refresh_grants", "authorization_codes"] as const) {
        const remaining = limit - removed;
        if (remaining === 0) break;
        const result = this.db
          .prepare(
            `DELETE FROM ${table} WHERE rowid IN
             (SELECT rowid FROM ${table} WHERE expires_at IS NOT NULL AND expires_at<=? LIMIT ?)`
          )
          .run(this.now(), remaining);
        removed += result.changes;
      }
      return removed;
    });
    return transaction();
  }

  async backup(destination: string): Promise<void> {
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    await this.db.backup(destination);
    chmodSync(destination, 0o600);
  }

  isHealthy(): boolean {
    return (this.db.prepare("SELECT 1 AS ok").get() as { ok: number }).ok === 1;
  }

  physicalTables(): string[] {
    return (
      this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
  }

  close(): void {
    this.db.close();
  }
}
