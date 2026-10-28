import { z } from "zod";

const int = () => z.coerce.number().int().positive();

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: int(),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: int(),
  REFRESH_TOKEN_TTL_SECONDS: int(),
  OTP_TTL_SECONDS: int(),
  OTP_RESEND_COOLDOWN_SECONDS: int(),
  OTP_MAX_ATTEMPTS: int(),
  DEV_LOG_OTP: z.string().default("false"),
  TMDB_API_KEY: z.string().min(1),
  ADMIN_EMAILS: z.string().default(""),
  // JSON array of engine URLs (or {"url", "name"} objects); one entry is a single-engine setup.
  EVO_ENGINES: z.string().default("").transform((v) => v.trim() || '["http://127.0.0.1:8000"]'),
  EVO_SECRET_TOKEN: z.string().default(""),
  // Optional: address of the stream Worker (tools/stream-worker). When set, viewers play video from it instead of
  // through this app, so the video does not count as Vercel transfer. Empty = the built-in /api/evo/stream proxy.
  STREAM_BASE: z.string().default("").transform((v) => v.trim().replace(/\/+$/, "")),
  // Optional: admin dashboard OpenRouter analytics. /activity needs a management key (openrouter.ai/settings/management-keys).
  OPENROUTER_API_KEY: z.string().default(""),
  // Error tracking: public base URL for links in alerts, who gets alert emails (default: ADMIN_EMAILS),
  // "off" to stop alert emails, and an optional Discord/Slack-compatible webhook.
  APP_URL: z.string().default(""),
  ERROR_ALERT_EMAILS: z.string().default(""),
  ERROR_ALERT_EMAIL: z.string().default("on"),
  ERROR_ALERT_WEBHOOK: z.string().default(""),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => i.path.join("."))
      .join(", ");
    throw new Error(`Invalid or missing environment variables: ${problems}`);
  }
  return {
    ...parsed.data,
    adminEmails: parsed.data.ADMIN_EMAILS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    isProd: parsed.data.NODE_ENV === "production",
    // Never true in production, whatever the variable says.
    devLogOtp:
      parsed.data.NODE_ENV !== "production" && parsed.data.DEV_LOG_OTP === "true",
  };
}

type Env = ReturnType<typeof load>;
let loaded: Env | undefined;

// Validated on first read, not at import: `next build` imports every route to collect page data, and CI builds
// have no runtime secrets. A missing variable still fails loudly the first time a request needs it.
export const env = new Proxy({} as Env, {
  get: (_, key) => (loaded ??= load())[key as keyof Env],
});
