import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isAdminEmail } from "@/lib/auth/admin";
import { currentUserId } from "@/lib/viewer/user";
import { bookmarkIds } from "@/lib/viewer/library";
import { inboxFor } from "@/lib/viewer/announcements";
import { supportNotification } from "@/lib/support/store";
import { summarizeInbox } from "@/app/api/me/inbox/summary";
import { ViewerSeedClient } from "./viewer-seed-client";

/** Only this tiny slot waits for the request; chrome and page content stream independently. */
export async function ViewerSeed() {
  const userId = await currentUserId();
  if (!userId) return null; // The viewer proxy owns authentication/approval redirects.
  // Notification outages should not replace an otherwise working page with an error boundary.
  const [bookmarks, announcements, unreadSupport, [user]] = await Promise.all([
    bookmarkIds(userId).catch(() => ({ movies: [], shows: [] })),
    inboxFor(userId).catch(() => ({ items: [], unread: 0 })),
    supportNotification(userId).catch(() => ({ count: 0, latest: null })),
    db.select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1).catch(() => []),
  ]);
  let isAdmin = false;
  if (user?.emailVerifiedAt) {
    try { isAdmin = await isAdminEmail(user.email); } catch { /* menu just hides the admin link */ }
  }
  const account = user ? { email: user.email, isAdmin } : null;
  return <ViewerSeedClient bookmarks={bookmarks} inbox={{ unreadSupport, announcements: summarizeInbox(announcements) }} account={account} />;
}
