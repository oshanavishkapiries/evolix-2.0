import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appConfig, configAudit } from "@/db/schema";
import { eq } from "drizzle-orm";

export type ConfigRow = { key: string; value: string; isSecret: boolean };
export type AuditRow = { key: string; scope: string; oldValue: string | null; newValue: string | null; actor: string; action: "set" | "reset" | "rollback" };
export interface ConfigRepository {
  readAll(): Promise<ConfigRow[]>;
  /** Atomic compare-and-swap + audit, committed together; false asks the caller to retry a concurrent edit. */
  write(expected: ConfigRow | undefined, next: ConfigRow | undefined, audit: AuditRow): Promise<boolean>;
  auditById(id: string): Promise<{ key: string; scope: string; oldValue: string | null } | undefined>;
}
export const configRepository: ConfigRepository = {
  async readAll() { return db.select().from(appConfig); },
  async auditById(id) { return (await db.select().from(configAudit).where(eq(configAudit.id, id)).limit(1))[0]; },
  async write(expected, next, audit) {
    // Neon HTTP does not support interactive transactions. A single data-modifying CTE both changes the
    // setting and appends its audit entry. CAS prevents an audit from claiming a stale previous value.
    const mutation = next
      ? expected
        ? sql`update app_config set value = ${next.value}, is_secret = ${next.isSecret}, updated_at = now(), updated_by = ${audit.actor} where key = ${audit.key} and value = ${expected.value} and is_secret = ${expected.isSecret} returning key`
        : sql`insert into app_config (key, value, is_secret, updated_by) values (${next.key}, ${next.value}, ${next.isSecret}, ${audit.actor}) on conflict do nothing returning key`
      : expected
        ? sql`delete from app_config where key = ${audit.key} and value = ${expected.value} and is_secret = ${expected.isSecret} returning key`
        : sql`select ${audit.key}::text as key where not exists (select 1 from app_config where key = ${audit.key})`;
    const rows = await db.execute(sql`with changed as (${mutation})
      insert into config_audit (key, scope, old_value, new_value, actor, action)
      select key, ${audit.scope}, ${audit.oldValue}, ${audit.newValue}, ${audit.actor}, ${audit.action}
      from changed returning id`);
    return rows.rows.length > 0;
  },
};
