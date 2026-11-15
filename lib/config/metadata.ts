/** Browser-safe configuration labels and controls. Schemas stay in registry.ts. */
export type ConfigKind = "string" | "int" | "bool" | "url" | "email-list" | "json";
export const configMetadata = {
  SMTP_HOST: { key: "SMTP_HOST", label: "SMTP host", description: "Outgoing mail server hostname", group: "Mail", kind: "string", secret: false, required: true, restartNeeded: false },
  SMTP_PORT: { key: "SMTP_PORT", label: "SMTP port", description: "Outgoing mail server port", group: "Mail", kind: "int", secret: false, required: true, restartNeeded: false },
  SMTP_USER: { key: "SMTP_USER", label: "SMTP user", description: "Outgoing mail login", group: "Mail", kind: "string", secret: false, required: true, restartNeeded: false },
  SMTP_PASS: { key: "SMTP_PASS", label: "SMTP password", description: "Outgoing mail password", group: "Mail", kind: "string", secret: true, required: true, restartNeeded: false },
  SMTP_FROM: { key: "SMTP_FROM", label: "Sender", description: "Outgoing mail From header", group: "Mail", kind: "string", secret: false, required: true, restartNeeded: false },
  JWT_ACCESS_SECRET: { key: "JWT_ACCESS_SECRET", label: "Access signing secret", description: "At least 32 characters; rotation invalidates access tokens", group: "Auth", kind: "string", secret: true, required: true, restartNeeded: false },
  JWT_REFRESH_SECRET: { key: "JWT_REFRESH_SECRET", label: "Refresh signing secret", description: "At least 32 characters; rotation invalidates refresh tokens", group: "Auth", kind: "string", secret: true, required: true, restartNeeded: false },
  ACCESS_TOKEN_TTL_SECONDS: { key: "ACCESS_TOKEN_TTL_SECONDS", label: "Access lifetime", description: "Access token lifetime in seconds", group: "Auth", kind: "int", secret: false, required: true, restartNeeded: false },
  REFRESH_TOKEN_TTL_SECONDS: { key: "REFRESH_TOKEN_TTL_SECONDS", label: "Refresh lifetime", description: "Refresh token lifetime in seconds", group: "Auth", kind: "int", secret: false, required: true, restartNeeded: false },
  OTP_TTL_SECONDS: { key: "OTP_TTL_SECONDS", label: "OTP lifetime", description: "OTP validity in seconds", group: "Auth", kind: "int", secret: false, required: true, restartNeeded: false },
  OTP_RESEND_COOLDOWN_SECONDS: { key: "OTP_RESEND_COOLDOWN_SECONDS", label: "OTP resend cooldown", description: "Minimum seconds between codes", group: "Auth", kind: "int", secret: false, required: true, restartNeeded: false },
  OTP_MAX_ATTEMPTS: { key: "OTP_MAX_ATTEMPTS", label: "OTP attempts", description: "Maximum verification attempts per code", group: "Auth", kind: "int", secret: false, required: true, restartNeeded: false },
  DEV_LOG_OTP: { key: "DEV_LOG_OTP", label: "Log development OTPs", description: "Never enabled in production", group: "Auth", kind: "bool", secret: false, required: false, restartNeeded: false },
  TMDB_API_KEY: { key: "TMDB_API_KEY", label: "TMDB API key", description: "TMDB v3 API key", group: "Integrations", kind: "string", secret: true, required: true, restartNeeded: false },
  ADMIN_EMAILS: { key: "ADMIN_EMAILS", label: "Admin emails", description: "Comma-separated admin allow-list", group: "Auth", kind: "email-list", secret: false, required: false, restartNeeded: false },
  EVO_ENGINES: { key: "EVO_ENGINES", label: "Evo engines", description: "Engine URLs or JSON array of URLs / {url, name}", group: "Evo", kind: "json", secret: false, required: false, restartNeeded: false },
  EVO_SECRET_TOKEN: { key: "EVO_SECRET_TOKEN", label: "Evo shared token", description: "Must match the engines until per-engine tokens land", group: "Evo", kind: "string", secret: true, required: false, restartNeeded: false },
  STREAM_BASE: { key: "STREAM_BASE", label: "Stream Worker URL", description: "Empty uses the built-in stream proxy", group: "Evo", kind: "url", secret: false, required: false, restartNeeded: false },
  OPENROUTER_API_KEY: { key: "OPENROUTER_API_KEY", label: "OpenRouter API key", description: "Management key for admin analytics", group: "Integrations", kind: "string", secret: true, required: false, restartNeeded: false },
  APP_URL: { key: "APP_URL", label: "Application URL", description: "Public base URL for error alert links", group: "Errors", kind: "url", secret: false, required: false, restartNeeded: false },
  ERROR_ALERT_EMAILS: { key: "ERROR_ALERT_EMAILS", label: "Error recipients", description: "Empty uses the admin allow-list", group: "Errors", kind: "email-list", secret: false, required: false, restartNeeded: false },
  ERROR_ALERT_EMAIL: { key: "ERROR_ALERT_EMAIL", label: "Email alerts", description: "Use off to disable email alerts", group: "Errors", kind: "string", secret: false, required: false, restartNeeded: false },
  ERROR_ALERT_WEBHOOK: { key: "ERROR_ALERT_WEBHOOK", label: "Error webhook", description: "Discord/Slack-compatible incoming webhook", group: "Errors", kind: "url", secret: true, required: false, restartNeeded: false },
} as const;
export const configFields = Object.values(configMetadata);
