import { configRegistry } from "./registry";
export { groupConfig, configChanges, type AdminConfigRow } from "./admin-form";
export function configValidation(key: string, value: unknown): string | undefined {
  const entry = configRegistry.find((e) => e.key === key);
  if (!entry) return "Unknown configuration key";
  if (entry.secret && value === "") return;
  const result = entry.validator.safeParse(value);
  // Registry messages are generated without including rejected values (including URL and enum inputs).
  if (!result.success) return entry.secret ? "Invalid secret: check the required format or length" : result.error.issues.map((i) => i.message).join("; ");
}
export const includesAdmin = (value: unknown, actor: string) => typeof value === "string" && value.split(",").some((e) => e.trim().toLowerCase() === actor.toLowerCase());
