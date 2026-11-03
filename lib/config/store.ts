import { z } from "zod";
import { includesAdmin } from "./admin-view";
import { configEntry, validateConfigValue, type ConfigKey } from "./registry";
import { encryptSecret, maskSecret } from "./crypto";
import { decodeConfigRow, fallbackValue, invalidateConfig } from "./index";
import { configRepository, type ConfigRepository } from "./repository";

/** Secret history contains masks only. To restore a secret, an admin must supply its value again. */
export function assertRollbackAllowed(key: string) {
  if (configEntry(key).secret) throw new Error(`Cannot roll back secret config key ${key}: audit history contains masked values only; set the secret again`);
}
export function createConfigStore(repository: ConfigRepository, invalidate = invalidateConfig, environment: Record<string, string | undefined> = process.env) {
  async function write(key: ConfigKey, value: unknown, actor: string, action: "set" | "reset" | "rollback") {
    const entry = configEntry(key);
    if (!z.email().safeParse(actor).success) throw new Error("Config actor must be an email address");
    // Admin forms leave a secret blank to keep it; only explicit reset removes the DB override.
    if (entry.secret && value === "" && action === "set") return;
    const parsed = action === "reset" ? undefined : validateConfigValue(key, value);
    const encoded = parsed === undefined ? undefined : JSON.stringify(parsed);
    const next = encoded === undefined ? undefined : { key, value: entry.secret ? encryptSecret(encoded) : encoded, isSecret: entry.secret };
    for (let attempt = 0; attempt < 5; attempt++) {
      const old = (await repository.readAll()).find((r) => r.key === key);
      const fallback = fallbackValue(key, environment);
      const validatedFallback = (action === "reset" || !old) && fallback !== undefined
        ? validateConfigValue(key, fallback) : undefined;
      const oldValue = old ? decodeConfigRow(old) : validatedFallback;
      const newValue = action === "reset" ? validatedFallback : parsed;
      const safe = (v: unknown) => v === undefined ? null : entry.secret ? maskSecret(String(v)) : JSON.stringify(v);
      if (await repository.write(old, next, { key, scope: "app", oldValue: safe(oldValue), newValue: safe(newValue), actor, action })) {
        invalidate();
        return;
      }
    }
    throw new Error(`Concurrent config edits for ${key}; please retry`);
  }
  return {
    setConfig: (key: ConfigKey, value: unknown, actor: string) => write(key, value, actor, "set"),
    resetConfig: (key: ConfigKey, actor: string) => write(key, undefined, actor, "reset"),
    /** Restore the pre-change effective value of an app audit entry as a DB override. */
    async rollbackConfig(id: string, actor: string) {
      const audit = await repository.auditById(id);
      if (!audit || audit.scope !== "app") throw new Error("App config audit entry not found");
      assertRollbackAllowed(audit.key);
      const key = configEntry(audit.key).key;
      if (audit.oldValue === null) throw new Error(`No previous value for ${key}; reset the key explicitly`);
      await write(key, JSON.parse(audit.oldValue), actor, "rollback");
    },
  };
}
export const { setConfig, resetConfig, rollbackConfig } = createConfigStore(configRepository);

/** Validate everything before one atomic batch statement; blank secrets preserve the current value. */
export async function setConfigBatch(values: Record<string, unknown>, actor: string, repository: ConfigRepository = configRepository, environment: Record<string, string | undefined> = process.env) {
  if (!z.email().safeParse(actor).success) throw new Error("Config actor must be an email address");
  if ("ADMIN_EMAILS" in values && !includesAdmin(values.ADMIN_EMAILS, actor)) throw new Error("ADMIN_EMAILS must include your own admin email");
  const parsed = Object.entries(values).flatMap(([key, value]) => {
    const entry = configEntry(key);
    if (entry.secret && value === "") return [];
    return [{ entry, value: validateConfigValue(key, value) }];
  });
  const rows = await repository.readAll();
  const mutations = parsed.map(({ entry, value }) => {
    const expected = rows.find((r) => r.key === entry.key);
    const old = expected ? decodeConfigRow(expected) : fallbackValue(entry.key, environment);
    const safe = (v: unknown) => v === undefined ? null : entry.secret ? maskSecret(String(v)) : JSON.stringify(v);
    const encoded = JSON.stringify(value);
    return { expected, next: { key: entry.key, value: entry.secret ? encryptSecret(encoded) : encoded, isSecret: entry.secret }, audit: { key: entry.key, scope: "app", oldValue: safe(old), newValue: safe(value), actor, action: "set" as const } };
  });
  await repository.writeBatch(mutations);
  invalidateConfig();
}
