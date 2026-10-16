import { NextRequest } from "next/server";
import { z } from "zod";
import {
  clientInfo,
  emailSchema,
  fail,
  json,
  parseBody,
  setAuthCookies,
} from "@/lib/auth/http";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isAdminEmail } from "@/lib/auth/admin";
import { verificationRequiredFor } from "@/lib/settings";
import { verifyDummy, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { findUserByEmail } from "@/lib/auth/users";

// No length rules here: login must not reveal the password policy.
const body = z.object({ email: emailSchema, password: z.string().min(1).max(128) });

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { email, password } = parsed.data;

  const user = await findUserByEmail(email);
  if (!user) {
    await verifyDummy(password);
    return fail(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    return fail(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  // Only reached with the correct password, so this does not leak account existence.
  if (!user.emailVerifiedAt) {
    // An admin switched verification off: accounts created while it was on may log in without the code.
    if (await verificationRequiredFor(email, isAdminEmail)) {
      return fail(403, "EMAIL_NOT_VERIFIED", "Email address is not verified");
    }
    await db.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
  }

  const { access, refresh } = await createSession(user.id, clientInfo(req));
  return setAuthCookies(json(200, { message: "Logged in" }), access, refresh);
}
