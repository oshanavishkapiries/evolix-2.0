import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { otps } from "@/db/schema";
import { env } from "@/lib/env";
import { sendOtpEmail } from "./mailer";

export type OtpPurpose = "verify_email" | "reset_password";

// Bound to user + purpose so a hash cannot be replayed across contexts.
const hashCode = (userId: string, purpose: OtpPurpose, code: string) =>
  createHmac("sha256", env.JWT_ACCESS_SECRET)
    .update(`${userId}:${purpose}:${code}`)
    .digest();

export type IssueResult =
  | { status: "sent" }
  | { status: "cooldown"; retryAfter: number }
  | { status: "mail_failed" };

/** Enforces the resend cooldown, replaces older OTPs, stores a hash and emails the code. */
export async function issueOtp(
  userId: string,
  email: string,
  purpose: OtpPurpose,
): Promise<IssueResult> {
  const [last] = await db
    .select({ createdAt: otps.createdAt })
    .from(otps)
    .where(and(eq(otps.userId, userId), eq(otps.purpose, purpose)))
    .orderBy(desc(otps.createdAt))
    .limit(1);
  if (last) {
    const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
    if (elapsed < env.OTP_RESEND_COOLDOWN_SECONDS) {
      return {
        status: "cooldown",
        retryAfter: Math.ceil(env.OTP_RESEND_COOLDOWN_SECONDS - elapsed),
      };
    }
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const now = new Date();
  await db
    .update(otps)
    .set({ consumedAt: now })
    .where(
      and(eq(otps.userId, userId), eq(otps.purpose, purpose), isNull(otps.consumedAt)),
    );
  await db.insert(otps).values({
    userId,
    purpose,
    codeHash: hashCode(userId, purpose, code).toString("hex"),
    expiresAt: new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000),
  });

  if (env.devLogOtp) console.log(`[dev] ${purpose} OTP for ${email}: ${code}`);

  try {
    await sendOtpEmail(email, code, purpose);
  } catch (err) {
    console.error("OTP email failed:", err instanceof Error ? err.message : "unknown");
    // In dev with OTP logging the code is still usable, so do not fail the flow.
    if (!env.devLogOtp) return { status: "mail_failed" };
  }
  return { status: "sent" };
}

/** Checks a submitted code. Every try is counted atomically; success consumes the OTP. */
export async function verifyOtp(userId: string, purpose: OtpPurpose, code: string) {
  const [current] = await db
    .select()
    .from(otps)
    .where(
      and(
        eq(otps.userId, userId),
        eq(otps.purpose, purpose),
        isNull(otps.consumedAt),
        gt(otps.expiresAt, new Date()),
        lt(otps.attempts, env.OTP_MAX_ATTEMPTS),
      ),
    )
    .orderBy(desc(otps.createdAt))
    .limit(1);
  if (!current) return false;

  const [counted] = await db
    .update(otps)
    .set({ attempts: sql`${otps.attempts} + 1` })
    .where(
      and(
        eq(otps.id, current.id),
        isNull(otps.consumedAt),
        lt(otps.attempts, env.OTP_MAX_ATTEMPTS),
      ),
    )
    .returning({ id: otps.id });
  if (!counted) return false;

  const expected = Buffer.from(current.codeHash, "hex");
  if (!timingSafeEqual(expected, hashCode(userId, purpose, code))) return false;

  // Single use: only one concurrent request can flip consumed_at.
  const consumed = await db
    .update(otps)
    .set({ consumedAt: new Date() })
    .where(and(eq(otps.id, current.id), isNull(otps.consumedAt)))
    .returning({ id: otps.id });
  return consumed.length === 1;
}
