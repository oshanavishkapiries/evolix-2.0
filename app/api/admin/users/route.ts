import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { emailSchema, json, parseBody, passwordSchema } from "@/lib/auth/http";
import { hashPassword } from "@/lib/auth/password";
import { adminRoute } from "@/lib/cms/api";

/** Create a user directly; a duplicate email maps to 409 in adminRoute. */
export const POST = adminRoute(async (req) => {
  const parsed = await parseBody(
    req,
    z.object({ email: emailSchema, password: passwordSchema, verified: z.boolean().default(true), approved: z.boolean().default(true) }),
  );
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  const now = new Date();
  const [user] = await db
    .insert(users)
    .values({ email: d.email, passwordHash: await hashPassword(d.password), emailVerifiedAt: d.verified ? now : null, approvedAt: d.approved ? now : null })
    .returning({ id: users.id, email: users.email });
  return json(201, { user });
});
