import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret, parseEncryptionKey, maskSecret, deriveEngineKey, encryptForEngine, decryptFromEngine } from "@/lib/config/crypto";
import { createCipheriv } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const key = Buffer.alloc(32, 7);
describe("config crypto", () => {
  it("accepts hex/base64 keys and rejects malformed or wrong-sized keys", () => {
    expect(parseEncryptionKey(key.toString("hex"))).toEqual(key);
    expect(parseEncryptionKey(key.toString("base64"))).toEqual(key);
    for (const bad of ["", "short", "z".repeat(64), Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64")]) expect(() => parseEncryptionKey(bad)).toThrow("CONFIG_ENCRYPTION_KEY");
  });
  it("round trips Unicode and empty values with a fresh IV", () => {
    for (const value of ["", "fixture-password", "රහස 🔐"]) {
      const a = encryptSecret(value, key);
      expect(a).toMatch(/^enc:v1:[\w-]{16}:[\w-]{22}:[\w-]*$/);
      expect(decryptSecret(a, key)).toBe(value);
      expect(encryptSecret(value, key)).not.toBe(a);
    }
  });
  it("rejects tampered IV, tag, ciphertext and wrong keys", () => {
    const envelope = encryptSecret("fixture-password", key);
    for (const i of [2, 3, 4]) {
      const parts = envelope.split(":");
      const bytes = Buffer.from(parts[i], "base64url"); bytes[0] ^= 1;
      parts[i] = bytes.toString("base64url");
      expect(() => decryptSecret(parts.join(":"), key)).toThrow();
    }
    expect(() => decryptSecret(envelope, Buffer.alloc(32, 8))).toThrow();
    for (const bad of ["plain", "enc:v2:a:b:c", "enc:v1:a:b:c"]) expect(() => decryptSecret(bad, key)).toThrow();
  });
  it("masks tails without revealing short secrets", () => {
    expect(maskSecret("example-abcd")).toBe("••••abcd");
    expect(maskSecret("abcd")).toBe("••••");
    expect(maskSecret("")).toBe("");
  });
  it("derives stable, token-specific engine keys and authenticates engine transport", () => {
    const token = "fixture-engine-token";
    expect(deriveEngineKey(token)).toHaveLength(32);
    expect(deriveEngineKey(token)).toEqual(deriveEngineKey(token));
    expect(deriveEngineKey(token)).not.toEqual(deriveEngineKey("another-token"));
    expect(() => deriveEngineKey("")).toThrow();
    const envelope = encryptForEngine("fixture-api-key", token);
    expect(decryptFromEngine(envelope, token)).toBe("fixture-api-key");
    expect(() => decryptFromEngine(envelope, "another-token")).toThrow();
    const parts = envelope.split(":"); parts[3] = Buffer.alloc(16).toString("base64url");
    expect(() => decryptFromEngine(parts.join(":"), token)).toThrow();
  });
  it("pins the Phase 4 HKDF contract to an independent known answer", () => {
    // Computed independently with Python cryptography HKDF-SHA256, salt/info from engine-push-contract.md.
    expect(deriveEngineKey("fixture-engine-token").toString("hex")).toBe("cdfe53b5f9713a8009fab25794a6ec2ceed52959015a405c39eae2dc24c5cc66");
  });
});
// Cross-language fixture is optional while the parallel engine worker is still building it.
const vectorPath = "evo-engine/tests/vectors/engine_config_crypto.json";
if (existsSync(vectorPath)) {
  it("matches the engine worker's transport vector", () => {
    const vector = JSON.parse(readFileSync(vectorPath, "utf8"));
    expect(deriveEngineKey(vector.token).toString("hex")).toBe(vector.derived_key_hex);
    expect(decryptFromEngine(vector.envelope, vector.token)).toBe(vector.plaintext);
    const parts = vector.envelope.split(":");
    const cipher = createCipheriv("aes-256-gcm", deriveEngineKey(vector.token), Buffer.from(parts[2], "base64url"));
    const encrypted = Buffer.concat([cipher.update(vector.plaintext, "utf8"), cipher.final()]);
    expect(encrypted.toString("base64url")).toBe(parts[4]);
    expect(cipher.getAuthTag().toString("base64url")).toBe(parts[3]);
  });
}
