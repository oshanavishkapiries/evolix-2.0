import { z } from "zod";
import { parseEngines } from "./engine-list";

import { configMetadata } from "./metadata";
export type { ConfigKind } from "./metadata";
const text = z.string();
const nonempty = text.min(1);
const int = z.preprocess((v) => typeof v === "string" && v.trim() ? Number(v) : v, z.number().int().positive());
const bool = z.preprocess((v) => v === "true" ? true : v === "false" ? false : v, z.boolean());
const url = z.union([z.literal(""), z.url().refine((v) => /^https?:\/\//.test(v), "Expected HTTP(S) URL")]);
const emails = text.refine((v) => v.split(",").map((e) => e.trim()).filter(Boolean).every((e) => z.email().safeParse(e).success), "Expected comma-separated email addresses");
// Preserve the existing string representation and legacy bare/comma-separated engine URLs.
const engineList = text.transform((v) => v.trim() || '["http://127.0.0.1:8000"]').refine((v) => {
  try {
    parseEngines(v);
    return true;
  } catch { return false; }
}, "Expected engine URLs or a JSON array of URLs / {url, name}");

function entry<M extends typeof configMetadata[keyof typeof configMetadata], V extends z.ZodType>(metadata: M, validator: V, fallback?: z.output<V>) {
  return { ...metadata, validator, default: fallback };
}
/** Single source of truth for all application configuration; bootstrap/public variables stay outside this registry. */
export const configRegistry = [
  entry(configMetadata.SMTP_HOST, nonempty),
  entry(configMetadata.SMTP_PORT, int, 587),
  entry(configMetadata.SMTP_USER, nonempty),
  entry(configMetadata.SMTP_PASS, nonempty),
  entry(configMetadata.SMTP_FROM, nonempty),
  entry(configMetadata.JWT_ACCESS_SECRET, text.min(32)),
  entry(configMetadata.JWT_REFRESH_SECRET, text.min(32)),
  entry(configMetadata.ACCESS_TOKEN_TTL_SECONDS, int, 3600),
  entry(configMetadata.REFRESH_TOKEN_TTL_SECONDS, int, 604800),
  entry(configMetadata.OTP_TTL_SECONDS, int, 600),
  entry(configMetadata.OTP_RESEND_COOLDOWN_SECONDS, int, 60),
  entry(configMetadata.OTP_MAX_ATTEMPTS, int, 5),
  entry(configMetadata.DEV_LOG_OTP, bool, false),
  entry(configMetadata.TMDB_API_KEY, nonempty),
  entry(configMetadata.ADMIN_EMAILS, emails, ""),
  entry(configMetadata.EVO_ENGINES, engineList, '["http://127.0.0.1:8000"]'),
  entry(configMetadata.EVO_SECRET_TOKEN, text, ""),
  entry(configMetadata.STREAM_BASE, url.transform((v) => v.trim().replace(/\/+$/, "")), ""),
  entry(configMetadata.OPENROUTER_API_KEY, text, ""),
  entry(configMetadata.APP_URL, url, ""),
  entry(configMetadata.ERROR_ALERT_EMAILS, emails, ""),
  entry(configMetadata.ERROR_ALERT_EMAIL, z.enum(["on", "off"]), "on"),
  entry(configMetadata.ERROR_ALERT_WEBHOOK, url, ""),
] as const;
export type ConfigKey = typeof configRegistry[number]["key"];
export type ConfigValues = { [E in typeof configRegistry[number] as E["key"]]: z.output<E["validator"]> };
export function configEntry(key: string) {
  const found = configRegistry.find((e) => e.key === key);
  if (!found) throw new Error(`Unknown config key: ${key}`);
  return found;
}
export function validateConfigValue(key: string, value: unknown): string | number | boolean {
  const parsed = configEntry(key).validator.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid or missing config value: ${key}`);
  return parsed.data;
}
