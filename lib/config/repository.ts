import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appConfig, configAudit } from "@/db/schema";
import { and, desc, eq, lt, or } from "drizzle-orm";

export type ConfigRow = { key: string; value: string; isSecret: boolean };
export type AuditRow = { key: string; scope: string; oldValue: string | null; newValue: string | null; actor: string; action: "set" | "reset" | "rollback" };
export type AuditEntry = AuditRow & { id: string; at: Date };
export type AuditFilter = { key?: string; limit?: number; before?: { at: Date; id: string } };
export type ConfigMutation = { expected: ConfigRow | undefined; next: ConfigRow; audit: AuditRow };
export interface ConfigRepository {
  listAudit(filters?: AuditFilter): Promise<AuditEntry[]>;
  writeBatch(mutations: ConfigMutation[]): Promise<void>;
  readAll(): Promise<ConfigRow[]>;
  /** Atomic compare-and-swap + audit, committed together; false asks the caller to retry a concurrent edit. */
  write(expected: ConfigRow | undefined, next: ConfigRow | undefined, audit: AuditRow): Promise<boolean>;
  auditById(id: string): Promise<{ key: string; scope: string; oldValue: string | null } | undefined>;
}
export const configRepository: ConfigRepository = {
  async listAudit({ key, limit = 25, before } = {}) {
    return db.select().from(configAudit).where(and(
      eq(configAudit.scope, "app"), key ? eq(configAudit.key, key) : undefined,
      before ? or(lt(configAudit.at, before.at), and(eq(configAudit.at, before.at), lt(configAudit.id, before.id))) : undefined,
    )).orderBy(desc(configAudit.at), desc(configAudit.id)).limit(Math.max(1, Math.min(limit, 101)));
  },
  async writeBatch(mutations) {
    if (!mutations.length) return;
    const input = JSON.stringify(mutations.map(({ expected, next, audit }) => ({
      key: next.key, value: next.value, secret: next.isSecret, expected: expected?.value ?? null,
      expected_secret: expected?.isSecret ?? null, actor: audit.actor, old_value: audit.oldValue, new_value: audit.newValue,
    })));
    // A failed CAS forces a SQL error, rolling back EVERY setting and audit in this statement.
    await db.execute(sql`with input as (
      select * from jsonb_to_recordset(${input}::jsonb) as x(key text, value text, secret boolean, expected text, expected_secret boolean, actor text, old_value text, new_value text)
    ), changed as (
      insert into app_config (key, value, is_secret, updated_by)
      select key, value, secret, actor from input where expected is null or exists (
        select 1 from app_config a where a.key = input.key and a.value = input.expected and a.is_secret = input.expected_secret
      )
      on conflict (key) do update set value = excluded.value, is_secret = excluded.is_secret, updated_by = excluded.updated_by, updated_at = now()
      where exists (select 1 from input i where i.key = app_config.key and i.expected = app_config.value and i.expected_secret = app_config.is_secret)
      returning key
    ), assertion as (
      select 1 / (case when count(*) = ${mutations.length} then 1 else 0 end) as valid from changed
    )
    insert into config_audit (key, scope, old_value, new_value, actor, action)
    select i.key, 'app', i.old_value, i.new_value, i.actor, 'set' from input i cross join assertion a where a.valid = 1`);
  },
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
