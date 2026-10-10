import { NextRequest } from "next/server";
import { z } from "zod";
import { emailSchema, fail, json, parseBody } from "@/lib/auth/http";
import { issueOtp } from "@/lib/auth/otp";
import { findUserByEmail } from "@/lib/auth/users";

const body = z.object({
  email: emailSchema,
  purpose: z.enum(["verify_email", "reset_password"]),
});
const GENERIC = "If an eligible account exists, a new code has been sent.";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { email, purpose } = parsed.data;

  const user = await findUserByEmail(email);
  const eligible =
    user && (purpose === "verify_email" ? !user.emailVerifiedAt : !!user.emailVerifiedAt);
  if (!eligible) return json(200, { message: GENERIC });

  const result = await issueOtp(user.id, email, purpose);
  if (result.status === "cooldown") {
    return fail(429, "OTP_COOLDOWN", "Please wait before requesting another code", {
      retryAfter: result.retryAfter,
    });
  }
  if (result.status === "mail_failed") {
    return fail(502, "MAIL_FAILED", "Could not send the email");
  }
  return json(200, { message: GENERIC });
}
