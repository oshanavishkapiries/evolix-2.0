import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isAdminEmail } from "@/lib/auth/admin";
import { emailSchema, fail, json, parseBody, passwordSchema } from "@/lib/auth/http";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { adminRoute, isUuid, notFound } from "@/lib/cms/api";

const patch = z.object({
  approved: z.boolean().optional(),
  verified: z.boolean().optional(),
  email: emailSchema.optional(),
  /** Sets a new password and signs the user out everywhere. */
  password: passwordSchema.optional(),
  /** Signs the user out everywhere without other changes. */
  revokeSessions: z.boolean().optional(),
});

const SELECT = { id: users.id, email: users.email, approvedAt: users.approvedAt, emailVerifiedAt: users.emailVerifiedAt };

/** Edit a user: approval, email verification, email, password, sign-out everywhere. */
export const PATCH = adminRoute<{ id: string }>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("User");
  const parsed = await parseBody(req, patch);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  const [current] = await db.select({ email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  if (!current) return notFound("User");
  if (d.email && d.email !== current.email && isAdminEmail(current.email))
    return fail(409, "CONFLICT", "Admin emails are set in ADMIN_EMAILS and cannot be changed here");

  const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (d.approved !== undefined) set.approvedAt = d.approved ? new Date() : null;
  if (d.verified !== undefined) set.emailVerifiedAt = d.verified ? new Date() : null;
  if (d.email) set.email = d.email;
  if (d.password) set.passwordHash = await hashPassword(d.password);
  const [row] = await db.update(users).set(set).where(eq(users.id, id)).returning(SELECT);
  if (d.password || d.revokeSessions) await revokeAllSessions(id);
  return row ? json(200, { user: row }) : notFound("User");
});

/** Delete a user and everything tied to them (sessions, progress, bookmarks cascade). */
export const DELETE = adminRoute<{ id: string }>(async (_req, { id }) => {
  if (!isUuid(id)) return notFound("User");
  const [current] = await db.select({ email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  if (!current) return notFound("User");
  if (isAdminEmail(current.email)) return fail(409, "CONFLICT", "Admin accounts cannot be deleted here");
  await db.delete(users).where(eq(users.id, id));
  return json(200, { ok: true });
});
