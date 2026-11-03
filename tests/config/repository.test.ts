import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite();
  return { db: drizzle(client), testClient: client };
});
import { configRepository } from "@/lib/config/repository";
import { createConfigStore } from "@/lib/config/store";
import * as database from "@/db";
import type { PGlite } from "@electric-sql/pglite";
const client = (database as unknown as { testClient: PGlite }).testClient;
const actor = "admin@example.test";
const audit = { key: "SMTP_PORT", scope: "app", actor, action: "set" as const, oldValue: "587", newValue: "2525" };
beforeAll(async () => { await client.exec(readFileSync("drizzle/0021_silky_victor_mancha.sql", "utf8")); });
beforeEach(async () => { await client.exec("truncate app_config, config_audit"); });
afterAll(async () => { await client.close(); });

describe("atomic SQL config repository", () => {
  it("inserts/updates/deletes overrides and writes audit entries in the same statement", async () => {
    const store = createConfigStore(configRepository, vi.fn(), {});
    await store.setConfig("SMTP_PORT", 2525, actor);
    expect((await configRepository.readAll())[0]).toMatchObject({ key: "SMTP_PORT", value: "2525", isSecret: false });
    await store.setConfig("SMTP_PORT", 465, actor);
    const entries = await client.query<{ id: string; old_value: string }>("select id, old_value from config_audit order by at");
    expect(entries.rows).toHaveLength(2);
    expect(entries.rows[1].old_value).toBe("2525");
    expect(await configRepository.auditById(entries.rows[1].id)).toMatchObject({ key: "SMTP_PORT", scope: "app", oldValue: "2525" });
    await store.resetConfig("SMTP_PORT", actor);
    expect(await configRepository.readAll()).toEqual([]);
    const count = await client.query<{ n: number }>("select count(*)::int as n from config_audit");
    expect(count.rows[0].n).toBe(3);
  });
  it("does not apply stale edits or write a misleading audit row", async () => {
    const first = { key: "SMTP_PORT", value: "2525", isSecret: false };
    expect(await configRepository.write(undefined, first, audit)).toBe(true);
    expect(await configRepository.write(undefined, { ...first, value: "465" }, audit)).toBe(false);
    expect(await configRepository.write({ ...first, value: "stale" }, undefined, audit)).toBe(false);
    expect(await configRepository.readAll()).toEqual([expect.objectContaining(first)]);
    const count = await client.query<{ n: number }>("select count(*)::int as n from config_audit");
    expect(count.rows[0].n).toBe(1);
  });
  it("rolls the setting change back if appending the audit row fails", async () => {
    const badAudit = { ...audit, scope: "invalid-scope" };
    await expect(configRepository.write(undefined, { key: "SMTP_PORT", value: "2525", isSecret: false }, badAudit)).rejects.toThrow();
    expect(await configRepository.readAll()).toEqual([]);
  });
  it("audits explicit reset even when there is no DB override", async () => {
    await createConfigStore(configRepository, vi.fn(), {}).resetConfig("SMTP_PORT", actor);
    const count = await client.query<{ n: number }>("select count(*)::int as n from config_audit");
    expect(count.rows[0].n).toBe(1);
  });
});

describe("audit history and atomic batches", () => {
  it("filters app scope and key and pages deterministically through equal timestamps", async () => {
    for (let i = 0; i < 5; i++) await client.query("insert into config_audit (key, scope, old_value, new_value, actor, action, at) values ($1, $2, '1', '2', $3, 'set', '2026-01-01T00:00:00Z')", [i === 4 ? "SMTP_HOST" : "SMTP_PORT", i === 3 ? "engine:one" : "app", actor]);
    const first = await configRepository.listAudit({ key: "SMTP_PORT", limit: 2 });
    expect(first).toHaveLength(2);
    expect(first.every((r) => r.key === "SMTP_PORT" && r.scope === "app")).toBe(true);
    const second = await configRepository.listAudit({ key: "SMTP_PORT", limit: 2, before: { at: first[1].at, id: first[1].id } });
    expect(second).toHaveLength(1);
    expect(new Set([...first, ...second].map((r) => r.id)).size).toBe(3);
    expect(await configRepository.listAudit({ key: "UNKNOWN" })).toEqual([]);
  });
  it("commits a complete batch with audits and rolls every edit back on one stale key", async () => {
    const { setConfigBatch } = await import("@/lib/config/store");
    await setConfigBatch({ SMTP_PORT: 2525, OTP_MAX_ATTEMPTS: 8 }, actor, configRepository, {});
    const original = await configRepository.readAll();
    expect(original).toHaveLength(2);
    expect(await configRepository.listAudit()).toHaveLength(2);
    const mutations = original.map((r) => ({ expected: r.key === "SMTP_PORT" ? { ...r, value: "stale" } : r, next: { ...r, value: "42" }, audit: { ...audit, key: r.key } }));
    await expect(configRepository.writeBatch(mutations)).rejects.toThrow();
    expect(await configRepository.readAll()).toEqual(original);
    expect(await configRepository.listAudit()).toHaveLength(2);
    await configRepository.writeBatch(original.map((r) => ({ expected: r, next: { ...r, value: "42" }, audit: { ...audit, key: r.key } })));
    expect((await configRepository.readAll()).every((r) => r.value === "42")).toBe(true);
    expect(await configRepository.listAudit()).toHaveLength(4);
  });
  it("rolls every edit back if a concurrent insert occupies an expected-empty key", async () => {
    await configRepository.write(undefined, { key: "SMTP_PORT", value: "2525", isSecret: false }, audit);
    await expect(configRepository.writeBatch([
      { expected: undefined, next: { key: "OTP_MAX_ATTEMPTS", value: "8", isSecret: false }, audit: { ...audit, key: "OTP_MAX_ATTEMPTS" } },
      { expected: undefined, next: { key: "SMTP_PORT", value: "465", isSecret: false }, audit },
    ])).rejects.toThrow();
    expect((await configRepository.readAll()).map((r) => r.key)).toEqual(["SMTP_PORT"]);
  });
});

it("validates an entire batch and prevents self-lockout before querying SQL", async () => {
  const { setConfigBatch } = await import("@/lib/config/store");
  const read = vi.spyOn(configRepository, "readAll");
  await expect(setConfigBatch({ SMTP_PORT: 465, OTP_MAX_ATTEMPTS: -1 }, actor, configRepository, {})).rejects.toThrow("OTP_MAX_ATTEMPTS");
  expect(read).not.toHaveBeenCalled();
  await expect(setConfigBatch({ ADMIN_EMAILS: "other@example.test" }, actor, configRepository, {})).rejects.toThrow("own admin email");
  expect(read).not.toHaveBeenCalled();
  read.mockRestore();
  expect(await configRepository.readAll()).toEqual([]);
});

it("encrypts batch secrets and masks audit values, while an empty secret produces no write", async () => {
  const { setConfigBatch } = await import("@/lib/config/store");
  vi.stubEnv("CONFIG_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  try {
    await setConfigBatch({ SMTP_PASS: "fixture-batch-password" }, actor, configRepository, { SMTP_PASS: "fixture-fallback-password" });
    const row = (await configRepository.readAll())[0];
    expect(row.value).toMatch(/^enc:v1:/);
    expect(row.value).not.toContain("fixture-batch-password");
    const history = await configRepository.listAudit();
    expect(history[0].oldValue).toBe("••••word");
    expect(history[0].newValue).toBe("••••word");
    await setConfigBatch({ SMTP_PASS: "" }, actor, configRepository, {});
    expect(await configRepository.listAudit()).toHaveLength(1);
    expect((await configRepository.readAll())[0]).toEqual(row);
  } finally { vi.unstubAllEnvs(); }
});
