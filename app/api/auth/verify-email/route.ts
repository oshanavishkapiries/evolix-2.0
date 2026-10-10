export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { emailSchema, fail, json, otpSchema, parseBody } from "@/lib/auth/http";
import { verifyOtp } from "@/lib/auth/otp";
import { findUserByEmail } from "@/lib/auth/users";

const body = z.object({ email: emailSchema, otp: otpSchema });

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { email, otp } = parsed.data;

  const user = await findUserByEmail(email);
  if (!user || user.emailVerifiedAt || !(await verifyOtp(user.id, "verify_email", otp))) {
    return fail(400, "INVALID_OTP", "Invalid or expired code");
  }
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));
  return json(200, { message: "Email verified" });
}
