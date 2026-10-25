import { z } from "zod";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound } from "@/lib/cms/api";
import { announcementWrite } from "@/lib/cms/announcement-api";
import { setArchived } from "@/lib/cms/announcements";

const body = z.object({ archived: z.boolean() });

export const POST = adminRoute<{ id: string }>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Announcement");
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  return announcementWrite(async () => {
    const row = await setArchived(id, parsed.data.archived);
    return row ? json(200, { announcement: row }) : notFound("Announcement");
  });
});
