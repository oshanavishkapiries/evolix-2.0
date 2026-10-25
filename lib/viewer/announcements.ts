import { and, desc, eq, exists, gt, isNull, lte, notExists, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { announcementReads, announcementRecipients, announcements, users } from "@/db/schema";
import { isAdminEmail } from "@/lib/auth/admin";
import { INBOX_LIMIT, type InboxItem } from "@/lib/announcements";

/** Live now and addressed to this user. Everything a viewer can read goes through here. */
function visibleTo(userId: string, admin: boolean) {
  const now = new Date();
  return and(
    eq(announcements.status, "published"),
    lte(announcements.publishAt, now),
    or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
    or(
      eq(announcements.audience, "everyone"),
      admin ? eq(announcements.audience, "admins") : undefined,
      and(
        eq(announcements.audience, "users"),
        exists(
          db
            .select({ one: sql`1` })
            .from(announcementRecipients)
            .where(and(eq(announcementRecipients.announcementId, announcements.id), eq(announcementRecipients.userId, userId))),
        ),
      ),
    ),
  );
}

async function isAdminUser(userId: string) {
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return u ? isAdminEmail(u.email) : false;
}

/** Newest first, with this user's read state and the total unread count. */
export async function inboxFor(userId: string): Promise<{ items: InboxItem[]; unread: number }> {
  const admin = await isAdminUser(userId);
  const readAt = announcementReads.readAt;
  const [rows, [{ unread }]] = await Promise.all([
    db
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        linkUrl: announcements.linkUrl,
        imageUrl: announcements.imageUrl,
        priority: announcements.priority,
        publishAt: announcements.publishAt,
        readAt,
      })
      .from(announcements)
      .leftJoin(announcementReads, and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.userId, userId)))
      .where(visibleTo(userId, admin))
      .orderBy(desc(announcements.publishAt))
      .limit(INBOX_LIMIT),
    db
      .select({ unread: sql<number>`count(*)::int` })
      .from(announcements)
      .where(
        and(
          visibleTo(userId, admin),
          notExists(db.select({ one: sql`1` }).from(announcementReads).where(and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.userId, userId)))),
        ),
      ),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      linkUrl: r.linkUrl,
      imageUrl: r.imageUrl,
      priority: r.priority,
      publishedAt: (r.publishAt ?? new Date(0)).toISOString(),
      read: Boolean(r.readAt),
    })),
    unread,
  };
}

/** Records the first read of one announcement, or of every unread one. Repeats keep the original time. */
export async function markRead(userId: string, target: { id: string } | { all: true }) {
  const admin = await isAdminUser(userId);
  const visible = db
    .select({ announcementId: announcements.id, userId: sql<string>`${userId}::uuid`.as("user_id"), readAt: sql<Date>`now()`.as("read_at") })
    .from(announcements)
    .where("id" in target ? and(visibleTo(userId, admin), eq(announcements.id, target.id)) : visibleTo(userId, admin));
  await db.insert(announcementReads).select(visible).onConflictDoNothing();
}
