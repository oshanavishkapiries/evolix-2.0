import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound } from "@/lib/cms/api";

/** Approve (or revoke) a user's permission to watch. */
export const PATCH = adminRoute<{ id: string }>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("User");
  const parsed = await parseBody(req, z.object({ approved: z.boolean() }));
  if ("error" in parsed) return parsed.error;
  const rows = await db
    .update(users)
    .set({ approvedAt: parsed.data.approved ? new Date() : null, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id, approvedAt: users.approvedAt });
  return rows.length ? json(200, { user: rows[0] }) : notFound("User");
});
