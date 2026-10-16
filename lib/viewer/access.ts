import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isAdminEmail } from "@/lib/auth/admin";
import { getSetting } from "@/lib/settings";

/** Whether this user may watch. Always true while the admin approval requirement is off; admins are always approved. */
export async function canWatch(userId: string | null): Promise<boolean> {
  if (!(await getSetting("requireApproval"))) return true;
  if (!userId) return false;
  const [u] = await db.select({ approvedAt: users.approvedAt, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(u && (u.approvedAt || isAdminEmail(u.email)));
}
