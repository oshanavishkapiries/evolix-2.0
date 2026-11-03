import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** Parse the bootstrap key without ever including its contents in an error. */
export function parseEncryptionKey(value = process.env.CONFIG_ENCRYPTION_KEY): Buffer {
  if (value && /^[a-f\d]{64}$/i.test(value)) return Buffer.from(value, "hex");
  if (value && /^[A-Za-z0-9+/]{43}=?$/.test(value)) {
    const key = Buffer.from(value, "base64");
    if (key.length === 32 && key.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "")) return key;
  }
  throw new Error("CONFIG_ENCRYPTION_KEY must be 64 hex characters or base64 encoding of exactly 32 bytes");
}

function encrypt(value: string, key: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}
function decrypt(envelope: string, key: Uint8Array): string {
  const parts = envelope.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1" || parts.slice(2).some((p) => !/^[\w-]*$/.test(p))) throw new Error("Invalid encrypted config envelope");
  const [iv, tag, ciphertext] = parts.slice(2).map((p) => Buffer.from(p, "base64url"));
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted config envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
export const encryptSecret = (value: string, key = parseEncryptionKey()) => encrypt(value, key);
export const decryptSecret = (value: string, key = parseEncryptionKey()) => decrypt(value, key);
/** Short secrets never expose their entire value. Empty means no secret is configured. */
export const maskSecret = (value: string) => value ? `••••${value.length > 4 ? value.slice(-4) : ""}` : "";

/** Phase 4 wire protocol: UTF-8 token, fixed salt/info, 32 bytes; independent of the app master key. */
export function deriveEngineKey(token: string): Buffer {
  if (!token) throw new Error("Engine token must not be empty");
  return Buffer.from(hkdfSync("sha256", token, "evolix-engine-config-v1", "engine-secrets", 32));
}
export const encryptForEngine = (value: string, token: string) => encrypt(value, deriveEngineKey(token));
export const decryptFromEngine = (value: string, token: string) => decrypt(value, deriveEngineKey(token));
