import { z } from "zod";
import { parseEngines } from "./engine-list";

export type ConfigKind = "string" | "int" | "bool" | "url" | "email-list" | "json";
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

function entry<K extends string, V extends z.ZodType>(key: K, label: string, description: string, group: string, kind: ConfigKind, validator: V, secret: boolean, required: boolean, fallback?: z.output<V>) {
  return { key, label, description, group, kind, validator, secret, required, default: fallback, restartNeeded: false as const };
}
/** Single source of truth for all application configuration; bootstrap/public variables stay outside this registry. */
export const configRegistry = [
  entry("SMTP_HOST", "SMTP host", "Outgoing mail server hostname", "Mail", "string", nonempty, false, true),
  entry("SMTP_PORT", "SMTP port", "Outgoing mail server port", "Mail", "int", int, false, true, 587),
  entry("SMTP_USER", "SMTP user", "Outgoing mail login", "Mail", "string", nonempty, false, true),
  entry("SMTP_PASS", "SMTP password", "Outgoing mail password", "Mail", "string", nonempty, true, true),
  entry("SMTP_FROM", "Sender", "Outgoing mail From header", "Mail", "string", nonempty, false, true),
  entry("JWT_ACCESS_SECRET", "Access signing secret", "At least 32 characters; rotation invalidates access tokens", "Auth", "string", text.min(32), true, true),
  entry("JWT_REFRESH_SECRET", "Refresh signing secret", "At least 32 characters; rotation invalidates refresh tokens", "Auth", "string", text.min(32), true, true),
  entry("ACCESS_TOKEN_TTL_SECONDS", "Access lifetime", "Access token lifetime in seconds", "Auth", "int", int, false, true, 3600),
  entry("REFRESH_TOKEN_TTL_SECONDS", "Refresh lifetime", "Refresh token lifetime in seconds", "Auth", "int", int, false, true, 604800),
  entry("OTP_TTL_SECONDS", "OTP lifetime", "OTP validity in seconds", "Auth", "int", int, false, true, 600),
  entry("OTP_RESEND_COOLDOWN_SECONDS", "OTP resend cooldown", "Minimum seconds between codes", "Auth", "int", int, false, true, 60),
  entry("OTP_MAX_ATTEMPTS", "OTP attempts", "Maximum verification attempts per code", "Auth", "int", int, false, true, 5),
  entry("DEV_LOG_OTP", "Log development OTPs", "Never enabled in production", "Auth", "bool", bool, false, false, false),
  entry("TMDB_API_KEY", "TMDB API key", "TMDB v3 API key", "Integrations", "string", nonempty, true, true),
  entry("ADMIN_EMAILS", "Admin emails", "Comma-separated admin allow-list", "Auth", "email-list", emails, false, false, ""),
  entry("EVO_ENGINES", "Evo engines", "Engine URLs or JSON array of URLs / {url, name}", "Evo", "json", engineList, false, false, '["http://127.0.0.1:8000"]'),
  entry("EVO_SECRET_TOKEN", "Evo shared token", "Must match the engines until per-engine tokens land", "Evo", "string", text, true, false, ""),
  entry("STREAM_BASE", "Stream Worker URL", "Empty uses the built-in stream proxy", "Evo", "url", url.transform((v) => v.trim().replace(/\/+$/, "")), false, false, ""),
  entry("OPENROUTER_API_KEY", "OpenRouter API key", "Management key for admin analytics", "Integrations", "string", text, true, false, ""),
  entry("APP_URL", "Application URL", "Public base URL for error alert links", "Errors", "url", url, false, false, ""),
  entry("ERROR_ALERT_EMAILS", "Error recipients", "Empty uses the admin allow-list", "Errors", "email-list", emails, false, false, ""),
  entry("ERROR_ALERT_EMAIL", "Email alerts", "Use off to disable email alerts", "Errors", "string", z.enum(["on", "off"]), false, false, "on"),
  entry("ERROR_ALERT_WEBHOOK", "Error webhook", "Discord/Slack-compatible incoming webhook", "Errors", "url", url, true, false, ""),
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
