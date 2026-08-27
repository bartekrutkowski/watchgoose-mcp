import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  randomBytes,
} from "node:crypto";
import type { JWK } from "oidc-provider";

export interface EncryptedValue {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
}

export function deriveKey(key: Buffer, label: string): Buffer {
  return createHmac("sha256", key).update("watchgoose-mcp\0").update(label).digest();
}

export function encrypt(value: string, key: Buffer, aad?: Buffer): EncryptedValue {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}

export function decrypt(value: EncryptedValue, key: Buffer, aad?: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, value.nonce);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(value.tag);
  return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString("utf8");
}

export function storageKey(model: string, value: string, key: Buffer): string {
  return createHmac("sha256", key).update(model).update("\0").update(value).digest("base64url");
}

export function opaqueAccountId(userId: number, key: Buffer): string {
  return `u${createHmac("sha256", key).update(String(userId)).digest("hex")}`;
}

export function deriveCookieKeys(key: Buffer): [string, string] {
  return [
    createHmac("sha256", key).update("watchgoose-mcp-cookie-current").digest("base64url"),
    createHmac("sha256", key).update("watchgoose-mcp-cookie-previous").digest("base64url"),
  ];
}

export function signCookie(name: string, value: string, key: string): string {
  // oidc-provider 9.11.5 signs its Keygrip cookies with HMAC-SHA1. This must
  // match that format for the internally resumed authorization request.
  return createHmac("sha1", key)
    .update(`${name}=${value}`)
    .digest("base64")
    .replaceAll("/", "_")
    .replaceAll("+", "-")
    .replaceAll("=", "");
}

export function deriveSigningJwk(key: Buffer): JWK {
  const seed = createHmac("sha256", key).update("watchgoose-mcp-ed25519-signing").digest();
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const jwk = createPrivateKey({
    key: Buffer.concat([pkcs8Prefix, seed]),
    format: "der",
    type: "pkcs8",
  }).export({ format: "jwk" });
  return {
    ...jwk,
    alg: "EdDSA",
    kid: createHmac("sha256", key).update("watchgoose-mcp-signing-kid").digest("base64url"),
    use: "sig",
  };
}
