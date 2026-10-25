import { json } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound } from "@/lib/cms/api";
import { announcementWrite } from "@/lib/cms/announcement-api";
import { publishAnnouncement } from "@/lib/cms/announcements";

export const POST = adminRoute<{ id: string }>(async (_req, { id }) => {
  if (!isUuid(id)) return notFound("Announcement");
  return announcementWrite(async () => {
    const row = await publishAnnouncement(id);
    return row ? json(200, { announcement: row }) : notFound("Announcement");
  });
});
