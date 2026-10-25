// Shared by the viewer inbox, the API and the admin pages.

export const ANNOUNCEMENT_AUDIENCES = [
  { key: "everyone", label: "Everyone" },
  { key: "admins", label: "Admins only" },
  { key: "users", label: "Specific users" },
] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number]["key"];
export const AUDIENCE_KEYS = ANNOUNCEMENT_AUDIENCES.map((a) => a.key) as [AnnouncementAudience, ...AnnouncementAudience[]];
export const audienceLabel = (key: string) => ANNOUNCEMENT_AUDIENCES.find((a) => a.key === key)?.label ?? key;

export const ANNOUNCEMENT_PRIORITIES = [
  { key: "inbox", label: "Inbox (bell only)" },
  { key: "banner", label: "Banner (also shown across the app until read)" },
] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number]["key"];
export const PRIORITY_KEYS = ANNOUNCEMENT_PRIORITIES.map((p) => p.key) as [AnnouncementPriority, ...AnnouncementPriority[]];

export const ANNOUNCEMENT_STATES = ["draft", "scheduled", "live", "expired", "archived"] as const;
export type AnnouncementState = (typeof ANNOUNCEMENT_STATES)[number];

export const TITLE_MAX = 120;
export const BODY_MAX = 2000;
/** Most users an announcement can be addressed to by hand. */
export const RECIPIENTS_MAX = 200;
/** Newest announcements shown in the inbox. */
export const INBOX_LIMIT = 50;

type StateInput = { status: "draft" | "published" | "archived"; publishAt: Date | null; expiresAt: Date | null };

/** Stored status plus the clock: scheduled, live and expired are never stored, so nothing needs a cron job. */
export function announcementState(a: StateInput, now = new Date()): AnnouncementState {
  if (a.status === "draft") return "draft";
  if (a.status === "archived") return "archived";
  if (a.publishAt && a.publishAt > now) return "scheduled";
  if (a.expiresAt && a.expiresAt <= now) return "expired";
  return "live";
}

/** Links go to a page of this app or an https address; anything else (javascript:, data:) is refused. */
export function isSafeLink(url: string) {
  if (url.startsWith("/")) return !url.startsWith("//");
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Pictures are loaded straight from their address, so only https (or an image of this app) is allowed. */
export function isSafeImage(url: string) {
  if (url.startsWith("/")) return !url.startsWith("//");
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** What a viewer sees in the bell, the inbox and banners. */
export type InboxItem = {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  imageUrl: string | null;
  priority: AnnouncementPriority;
  publishedAt: string;
  read: boolean;
};
