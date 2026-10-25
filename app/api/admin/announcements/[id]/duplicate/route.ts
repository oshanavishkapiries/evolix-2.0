import { fail, json } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound } from "@/lib/cms/api";
import { adminId } from "@/lib/cms/announcement-api";
import { duplicateAnnouncement } from "@/lib/cms/announcements";

/** Copies an announcement (any state) into a new draft. */
export const POST = adminRoute<{ id: string }>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Announcement");
  const by = await adminId(req);
  if (!by) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const row = await duplicateAnnouncement(id, by);
  return row ? json(201, { announcement: row }) : notFound("Announcement");
});
