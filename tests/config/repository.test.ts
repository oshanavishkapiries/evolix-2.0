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
