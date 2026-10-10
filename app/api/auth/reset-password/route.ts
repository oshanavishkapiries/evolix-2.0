export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { emailSchema, fail, json, otpSchema, parseBody, passwordSchema } from "@/lib/auth/http";
import { verifyOtp } from "@/lib/auth/otp";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { findUserByEmail } from "@/lib/auth/users";

const body = z.object({ email: emailSchema, otp: otpSchema, newPassword: passwordSchema });

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { email, otp, newPassword } = parsed.data;

  const user = await findUserByEmail(email);
  if (!user || !(await verifyOtp(user.id, "reset_password", otp))) {
    return fail(400, "INVALID_OTP", "Invalid or expired code");
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, user.id));
  await revokeAllSessions(user.id);
  return json(200, { message: "Password updated" });
}
