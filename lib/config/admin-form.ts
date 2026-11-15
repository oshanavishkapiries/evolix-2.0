import { configFields as configRegistry } from "./metadata";
import { parseEngines } from "./engine-list";
export type AdminConfigRow = { key: string; value: string | number | boolean; source: "db" | "env" | "default" };
export function groupConfig(rows: AdminConfigRow[]) {
  return [...new Set(configRegistry.map((e) => e.group))].map((group) => ({ group, items: configRegistry.filter((e) => e.group === group).map((entry) => ({ ...entry, ...rows.find((r) => r.key === entry.key) })) }));
}
export function configChanges(rows: AdminConfigRow[], values: Record<string, unknown>) {
  return Object.fromEntries(configRegistry.filter((e) => e.key in values && (e.secret ? values[e.key] !== "" : String(values[e.key]) !== String(rows.find((r) => r.key === e.key)?.value))).map((e) => [e.key, values[e.key]]));
}
/** Fast form feedback; writes always run the full server registry validators. */
export function configValidation(key: string, value: unknown): string | undefined {
  const entry = configRegistry.find((e) => e.key === key);
  if (!entry) return "Unknown configuration key";
  if (entry.secret && value === "") return;
  const invalid = () => entry.secret ? "Invalid secret: check the required format or length" : "Check the required format or value";
  if (entry.kind === "int") return (typeof value === "number" || typeof value === "string" && value.trim()) && Number.isInteger(Number(value)) && Number(value) > 0 ? undefined : invalid();
  if (entry.kind === "bool") return [true, false, "true", "false"].includes(value as boolean) ? undefined : invalid();
  if (typeof value !== "string") return invalid();
  if (entry.required && !value.length) return invalid();
  if ((key === "JWT_ACCESS_SECRET" || key === "JWT_REFRESH_SECRET") && value.length < 32) return invalid();
  if (key === "ERROR_ALERT_EMAIL" && value !== "on" && value !== "off") return invalid();
  if (entry.kind === "url" && value) {
    try { const url = new URL(value); if (!/^https?:$/.test(url.protocol)) return invalid(); }
    catch { return invalid(); }
  }
  if (entry.kind === "email-list" && !value.split(",").map((s) => s.trim()).filter(Boolean).every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return invalid();
  if (key === "EVO_ENGINES") { try { parseEngines(value.trim() || '["http://127.0.0.1:8000"]'); } catch { return invalid(); } }
}
