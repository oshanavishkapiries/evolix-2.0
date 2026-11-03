import { configRegistry } from "./registry";
export type AdminConfigRow = { key: string; value: string | number | boolean; source: "db" | "env" | "default" };
export function groupConfig(rows: AdminConfigRow[]) {
  return [...new Set(configRegistry.map((e) => e.group))].map((group) => ({ group, items: configRegistry.filter((e) => e.group === group).map((entry) => ({ ...entry, ...rows.find((r) => r.key === entry.key) })) }));
}
export function configChanges(rows: AdminConfigRow[], values: Record<string, unknown>) {
  return Object.fromEntries(configRegistry.filter((e) => e.key in values && (e.secret ? values[e.key] !== "" : String(values[e.key]) !== String(rows.find((r) => r.key === e.key)?.value))).map((e) => [e.key, values[e.key]]));
}
export function configValidation(key: string, value: unknown): string | undefined {
  const entry = configRegistry.find((e) => e.key === key);
  if (!entry) return "Unknown configuration key";
  if (entry.secret && value === "") return;
  const result = entry.validator.safeParse(value);
  // Registry messages are generated without including rejected values (including URL and enum inputs).
  if (!result.success) return entry.secret ? "Invalid secret: check the required format or length" : result.error.issues.map((i) => i.message).join("; ");
}
export const includesAdmin = (value: unknown, actor: string) => typeof value === "string" && value.split(",").some((e) => e.trim().toLowerCase() === actor.toLowerCase());
