import { json, parseBody } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound } from "@/lib/cms/api";
import { announcementWrite } from "@/lib/cms/announcement-api";
import { announcementInput, deleteDraft, getAnnouncement, updateAnnouncement } from "@/lib/cms/announcements";

export const GET = adminRoute<{ id: string }>(async (_req, { id }) => {
  const row = isUuid(id) ? await getAnnouncement(id) : null;
  return row ? json(200, { announcement: row }) : notFound("Announcement");
});

/** Edits a draft, or corrects a published announcement in place. */
export const PATCH = adminRoute<{ id: string }>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Announcement");
  const parsed = await parseBody(req, announcementInput);
  if ("error" in parsed) return parsed.error;
  return announcementWrite(async () => {
    const row = await updateAnnouncement(id, parsed.data);
    return row ? json(200, { announcement: row }) : notFound("Announcement");
  });
});

/** Drafts only: anything that was sent is archived instead, so its read stats survive. */
export const DELETE = adminRoute<{ id: string }>(async (_req, { id }) => {
  if (!isUuid(id)) return notFound("Announcement");
  return (await deleteDraft(id)) ? json(200, { deleted: true }) : notFound("Draft");
});
