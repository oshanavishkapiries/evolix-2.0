import { createHash } from "node:crypto";
import type { InboxItem } from "@/lib/announcements";

export type InboxSummary = { items: (InboxItem & { bodyLoaded: boolean; bodyVersion: string })[]; unread: number };

/** Keep visible banner/popup content; bell-only bodies are fetched when the bell opens. */
export function summarizeInbox(inbox: { items: InboxItem[]; unread: number }): InboxSummary {
  return { ...inbox, items: inbox.items.map((item) => ({ ...item, body: item.priority === "inbox" ? "" : item.body, bodyLoaded: item.priority !== "inbox", bodyVersion: createHash("sha256").update(item.body).digest("base64url").slice(0, 16) })) };
}
