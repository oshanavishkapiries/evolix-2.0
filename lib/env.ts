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
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues
    .map((i) => i.path.join("."))
    .join(", ");
  throw new Error(`Invalid or missing environment variables: ${problems}`);
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === "production",
  // Never true in production, whatever the variable says.
  devLogOtp:
    parsed.data.NODE_ENV !== "production" && parsed.data.DEV_LOG_OTP === "true",
};
