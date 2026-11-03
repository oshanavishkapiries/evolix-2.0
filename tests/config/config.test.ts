import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configRegistry, validateConfigValue } from "@/lib/config/registry";
import { createConfigLoader } from "@/lib/config";
import { createConfigStore } from "@/lib/config/store";
import { decryptSecret } from "@/lib/config/crypto";
import type { ConfigRepository, ConfigRow, AuditRow } from "@/lib/config/repository";

function environment(): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", SMTP_HOST: "smtp.example.test", SMTP_USER: "fixture-user", SMTP_PASS: "fixture-mail-password", SMTP_FROM: "App <app@example.test>", JWT_ACCESS_SECRET: "a".repeat(32), JWT_REFRESH_SECRET: "b".repeat(32), TMDB_API_KEY: "fixture-tmdb-key" };
}
class MemoryRepository implements ConfigRepository {
  rows = new Map<string, ConfigRow>();
  audits: AuditRow[] = [];
  down = false;
  reads = 0;
  async readAll() { this.reads++; if (this.down) throw new Error("offline"); return [...this.rows.values()]; }
  async write(expected: ConfigRow | undefined, next: ConfigRow | undefined, audit: AuditRow) {
    if (this.down) throw new Error("offline");
    const current = this.rows.get(audit.key);
    if (current?.value !== expected?.value) return false;
    if (next) this.rows.set(next.key, next); else this.rows.delete(audit.key);
    this.audits.push(audit);
    return true;
  }
  async auditById(id: string) { return this.audits[Number(id)]; }
}
beforeEach(() => { vi.stubEnv("CONFIG_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64")); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("registry", () => {
  it("declares every in-scope app key exactly once with complete admin metadata", () => {
    expect(configRegistry).toHaveLength(23);
    expect(new Set(configRegistry.map((e) => e.key)).size).toBe(23);
    for (const e of configRegistry) {
      expect(e.label && e.description && e.group).toBeTruthy();
      expect(e.restartNeeded).toBe(false);
      if (e.default !== undefined) expect(e.validator.safeParse(e.default).success).toBe(true);
    }
  });
  it("validates every kind and never leaks rejected values", () => {
    expect(validateConfigValue("SMTP_HOST", "smtp.example.test")).toBe("smtp.example.test");
    expect(validateConfigValue("SMTP_PORT", "587")).toBe(587);
    expect(validateConfigValue("DEV_LOG_OTP", "true")).toBe(true);
    expect(validateConfigValue("DEV_LOG_OTP", false)).toBe(false);
    expect(validateConfigValue("APP_URL", "https://example.test")).toBe("https://example.test");
    expect(validateConfigValue("ADMIN_EMAILS", "a@example.test, b@example.test")).toContain("b@");
    expect(validateConfigValue("EVO_ENGINES", '[{"url":"http://127.0.0.1:8000","name":"Local"}]')).toContain("Local");
    expect(validateConfigValue("EVO_ENGINES", "http://127.0.0.1:8000")).toContain("8000");
    for (const [key, bad] of [["SMTP_HOST", ""], ["SMTP_PORT", "0"], ["SMTP_PORT", "1.5"], ["SMTP_PORT", true], ["DEV_LOG_OTP", "yes"], ["APP_URL", "javascript:bad"], ["ADMIN_EMAILS", "bad-email"], ["EVO_ENGINES", "{}"], ["EVO_ENGINES", "["], ["EVO_ENGINES", "[]"], ["JWT_ACCESS_SECRET", "fixture-short-secret"]] as const) {
      expect(() => validateConfigValue(key, bad)).toThrow(key);
      try { validateConfigValue(key, bad); } catch (e) { expect(String(e)).not.toContain(String(bad) === "" ? "fixture-short-secret" : `: ${bad}`); }
    }
    expect(() => validateConfigValue("UNKNOWN", "value")).toThrow("Unknown config key");
  });
});

describe("loader and writes", () => {
  it("uses DB > env > default, exposes sources, and refreshes after writes/resets", async () => {
    const repo = new MemoryRepository(); const env = { ...environment(), SMTP_PORT: "2525" };
    const loader = createConfigLoader(repo, env);
    const store = createConfigStore(repo, loader.invalidateConfig, env);
    expect((await loader.getConfig()).SMTP_PORT).toBe(2525);
    expect(await loader.getConfigSource("SMTP_PORT")).toBe("env");
    expect(await loader.getConfigSource("OTP_MAX_ATTEMPTS")).toBe("default");
    await store.setConfig("SMTP_PORT", "465", "admin@example.test");
    expect((await loader.getConfig()).SMTP_PORT).toBe(465);
    expect(await loader.getConfigSource("SMTP_PORT")).toBe("db");
    await store.resetConfig("SMTP_PORT", "admin@example.test");
    expect((await loader.getConfig()).SMTP_PORT).toBe(2525);
    expect(repo.audits.map((a) => a.action)).toEqual(["set", "reset"]);
    expect(repo.audits[1]).toMatchObject({ oldValue: "465", newValue: "2525" });
  });
  it("falls back with one sanitized warning when DB is down; still names missing required keys", async () => {
    const repo = new MemoryRepository(); repo.down = true; const warn = vi.fn();
    const env = environment(); const loader = createConfigLoader(repo, env, 0, warn);
    expect((await loader.getConfig()).TMDB_API_KEY).toBe(env.TMDB_API_KEY);
    await loader.getConfig(); expect(warn).toHaveBeenCalledTimes(1);
    delete env.JWT_ACCESS_SECRET;
    await expect(loader.getConfig()).rejects.toThrow("JWT_ACCESS_SECRET");
  });
  it("coalesces reads, expires the cache, and does not cache failed validation", async () => {
    vi.useFakeTimers();
    const repo = new MemoryRepository(); const env = environment(); const loader = createConfigLoader(repo, env);
    await Promise.all([loader.getConfig(), loader.getConfig()]); expect(repo.reads).toBe(1);
    await loader.getConfig(); expect(repo.reads).toBe(1);
    vi.advanceTimersByTime(15001); await loader.getConfig(); expect(repo.reads).toBe(2);
    delete env.SMTP_HOST; loader.invalidateConfig();
    await expect(loader.getConfig()).rejects.toThrow("SMTP_HOST");
    env.SMTP_HOST = "restored"; expect((await loader.getConfig()).SMTP_HOST).toBe("restored");
  });
  it("keeps derived forms and disables development OTP logging in production", async () => {
    const env = { ...environment(), NODE_ENV: "production", DEV_LOG_OTP: "true", ADMIN_EMAILS: " Admin@Example.test, other@example.test ", STREAM_BASE: "https://stream.example.test///", EVO_ENGINES: "" };
    const config = await createConfigLoader(new MemoryRepository(), env).getConfig();
    expect(config.adminEmails).toEqual(["admin@example.test", "other@example.test"]);
    expect(config.isProd).toBe(true); expect(config.devLogOtp).toBe(false);
    expect(config.STREAM_BASE).toBe("https://stream.example.test");
    expect(config.EVO_ENGINES).toBe('["http://127.0.0.1:8000"]');
  });
  it("encrypts secrets, masks all audit/admin values, keeps blank secrets, and explicitly resets", async () => {
    const repo = new MemoryRepository(); const env = environment();
    const loader = createConfigLoader(repo, env); const store = createConfigStore(repo, loader.invalidateConfig, env);
    const value = "fixture-new-mail-password";
    await store.setConfig("SMTP_PASS", value, "admin@example.test");
    const row = repo.rows.get("SMTP_PASS")!;
    expect(row.isSecret).toBe(true); expect(row.value).toMatch(/^enc:v1:/);
    expect(JSON.parse(decryptSecret(row.value))).toBe(value);
    expect((await loader.getConfig()).SMTP_PASS).toBe(value);
    const admin = await loader.getRawConfigForAdmin();
    expect(admin.find((r) => r.key === "SMTP_PASS")).toEqual({ key: "SMTP_PASS", value: "••••word", source: "db" });
    expect(JSON.stringify(admin)).not.toContain(value);
    await store.setConfig("SMTP_PASS", "", "admin@example.test");
    expect(repo.rows.get("SMTP_PASS")).toEqual(row); expect(repo.audits).toHaveLength(1);
    await expect(store.rollbackConfig("0", "admin@example.test")).rejects.toThrow(/Cannot roll back secret.*masked/);
    await store.resetConfig("SMTP_PASS", "admin@example.test");
    expect((await loader.getConfig()).SMTP_PASS).toBe(env.SMTP_PASS);
    expect(JSON.stringify(repo.audits)).not.toContain(value);
    expect(JSON.stringify(repo.audits)).not.toContain(env.SMTP_PASS);
    expect(JSON.stringify(repo.audits)).not.toContain("enc:v1:");
    expect(repo.audits.every((a) => a.oldValue?.startsWith("••••") && a.newValue?.startsWith("••••"))).toBe(true);
  });
  it("rolls nonsecret values back and rejects invalid writes before mutation", async () => {
    const repo = new MemoryRepository(); const env = environment(); const store = createConfigStore(repo, vi.fn(), env);
    await store.setConfig("SMTP_PORT", 2525, "admin@example.test");
    await store.rollbackConfig("0", "admin@example.test");
    expect(JSON.parse(repo.rows.get("SMTP_PORT")!.value)).toBe(587);
    expect(repo.audits[1].action).toBe("rollback");
    await expect(store.setConfig("SMTP_PORT", -1, "admin@example.test")).rejects.toThrow("SMTP_PORT");
    await expect(store.setConfig("SMTP_PORT", 587, "invalid")).rejects.toThrow("email");
    expect(repo.audits).toHaveLength(2);
  });
  it("fails writes when DB is down instead of silently dropping an edit", async () => {
    const repo = new MemoryRepository(); repo.down = true;
    await expect(createConfigStore(repo).setConfig("SMTP_PORT", 587, "admin@example.test")).rejects.toThrow("offline");
    expect(repo.audits).toHaveLength(0);
  });
});
