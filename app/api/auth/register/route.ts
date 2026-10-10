export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { emailSchema, fail, json, parseBody, passwordSchema } from "@/lib/auth/http";
import { issueOtp } from "@/lib/auth/otp";
import { hashPassword } from "@/lib/auth/password";
import { findUserByEmail } from "@/lib/auth/users";

const body = z.object({ email: emailSchema, password: passwordSchema });
const GENERIC = "If the address can be registered, a verification code has been sent.";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { email, password } = parsed.data;

  let user = await findUserByEmail(email);
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
