import { NextRequest } from "next/server";
import { z } from "zod";
import { emailSchema, json, parseBody } from "@/lib/auth/http";
import { issueOtp } from "@/lib/auth/otp";
import { findUserByEmail } from "@/lib/auth/users";

const body = z.object({ email: emailSchema });

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { email } = parsed.data;

  const user = await findUserByEmail(email);
  // Cooldown and mail failures are swallowed so the response never depends on the account.
  if (user?.emailVerifiedAt) await issueOtp(user.id, email, "reset_password");
  return json(200, { message: "If the account exists, a reset code has been sent." });
}
