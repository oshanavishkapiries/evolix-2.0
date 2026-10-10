export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { fail, json } from "@/lib/auth/http";
import { authenticate } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");

  const [user] = await db
    .select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, auth.userId))
    .limit(1);
  if (!user) return fail(401, "UNAUTHORIZED", "Not authenticated");
  return json(200, { user });
}
