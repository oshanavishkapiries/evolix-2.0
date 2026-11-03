import { configRegistry, configEntry, validateConfigValue, type ConfigKey, type ConfigValues } from "./registry";
import { decryptSecret, maskSecret } from "./crypto";
import { configRepository, type ConfigRepository, type ConfigRow } from "./repository";

export type ConfigSource = "db" | "env" | "default";
export type Config = ConfigValues & { NODE_ENV: string; adminEmails: string[]; isProd: boolean; devLogOtp: boolean };
export function decodeConfigRow(row: ConfigRow): unknown {
  return JSON.parse(row.isSecret ? decryptSecret(row.value) : row.value);
}
export function fallbackValue(key: ConfigKey, environment: Record<string, string | undefined> = process.env): unknown {
  return environment[key] ?? configEntry(key).default;
}
/** Injectable factory lets tests exercise cache/fallback semantics without a database or network. */
export function createConfigLoader(repository: Pick<ConfigRepository, "readAll">, environment: Record<string, string | undefined> = process.env, ttl = 15_000, warn: (message: string) => void = console.warn) {
  let generation = 0;
  let warned = false;
  let cached: { config: Config; sources: Record<ConfigKey, ConfigSource>; expires: number } | undefined;
  let pending: Promise<NonNullable<typeof cached>> | undefined;
  async function read() {
    let rows: ConfigRow[];
    try { rows = await repository.readAll(); }
    catch {
      rows = [];
      if (!warned) { warn("Config database unavailable; using environment/default values"); warned = true; }
    }
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const values: Record<string, unknown> = {};
    const sources = {} as Record<ConfigKey, ConfigSource>;
    for (const entry of configRegistry) {
      const row = byKey.get(entry.key);
      sources[entry.key] = row ? "db" : environment[entry.key] !== undefined ? "env" : "default";
      let raw: unknown;
      try { raw = row ? decodeConfigRow(row) : fallbackValue(entry.key, environment); }
      catch { throw new Error(`Cannot decode config value: ${entry.key}; check CONFIG_ENCRYPTION_KEY for encrypted values`); }
      values[entry.key] = validateConfigValue(entry.key, raw);
    }
    const parsed = values as ConfigValues;
    const nodeEnv = environment.NODE_ENV ?? "development";
    const config: Config = {
      ...parsed,
      NODE_ENV: nodeEnv,
      adminEmails: parsed.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
      isProd: nodeEnv === "production",
      devLogOtp: nodeEnv !== "production" && parsed.DEV_LOG_OTP,
    };
    return { config, sources, expires: Date.now() + ttl };
  }
  async function snapshot() {
    if (cached && cached.expires > Date.now()) return cached;
    if (!pending) {
      const started = generation;
      const request = read();
      pending = request;
      void request.then((result) => { if (generation === started) cached = result; }, () => {}).finally(() => { if (pending === request) pending = undefined; });
    }
    return pending;
  }
  return {
    async getConfig() { return (await snapshot()).config; },
    invalidateConfig() { generation++; cached = undefined; pending = undefined; },
    async getConfigSource(key: ConfigKey) { configEntry(key); return (await snapshot()).sources[key]; },
    async getRawConfigForAdmin() {
      const { config, sources } = await snapshot();
      return configRegistry.map((e) => ({ key: e.key, value: e.secret ? maskSecret(String(config[e.key])) : config[e.key], source: sources[e.key] }));
    },
  };
}
const loader = createConfigLoader(configRepository);
export const { getConfig, invalidateConfig, getConfigSource, getRawConfigForAdmin } = loader;
