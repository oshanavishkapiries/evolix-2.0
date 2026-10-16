import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isAdminEmail } from "@/lib/auth/admin";
import { clientInfo, emailSchema, fail, json, parseBody, passwordSchema, setAuthCookies } from "@/lib/auth/http";
import { issueOtp } from "@/lib/auth/otp";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { findUserByEmail } from "@/lib/auth/users";
import { verificationRequiredFor } from "@/lib/settings";
import { eq } from "drizzle-orm";

const body = z.object({ email: emailSchema, password: passwordSchema });
const GENERIC = "If the address can be registered, a verification code has been sent.";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { email, password } = parsed.data;

  let user = await findUserByEmail(email);

  // Verification switched off by an admin: the account is usable at once (never for admin addresses).
  if (!(await verificationRequiredFor(email, isAdminEmail))) {
    if (user && !(await verifyPassword(user.passwordHash, password))) {
      return fail(409, "EMAIL_TAKEN", "An account with this email already exists. Log in instead.");
    }
    if (!user) {
      const passwordHash = await hashPassword(password);
      const [created] = await db.insert(users).values({ email, passwordHash, emailVerifiedAt: new Date() }).onConflictDoNothing().returning();
      user = created ?? (await findUserByEmail(email));
      if (!user) return fail(500, "INTERNAL_ERROR", "Could not create account");
    } else if (!user.emailVerifiedAt) {
      await db.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
    }
    const { access, refresh } = await createSession(user.id, clientInfo(req));
    return setAuthCookies(json(200, { message: "Account ready", autoLogin: true }), access, refresh);
  }

  // Verified accounts get the same response and no email, so existence stays hidden.
  if (user?.emailVerifiedAt) return json(200, { message: GENERIC });

  if (!user) {
    const passwordHash = await hashPassword(password);
    const [created] = await db
      .insert(users)
      .values({ email, passwordHash })
      .onConflictDoNothing()
      .returning();
    user = created ?? (await findUserByEmail(email));
    if (!user) return fail(500, "INTERNAL_ERROR", "Could not create account");
  }

  const result = await issueOtp(user.id, email, "verify_email");
  if (result.status === "mail_failed") {
    return fail(502, "MAIL_FAILED", "Could not send the verification email");
  }
  return json(200, { message: GENERIC });
}
