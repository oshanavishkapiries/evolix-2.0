import { z } from "zod";
import { fail, json, parseBody } from "@/lib/auth/http";
import { ANNOUNCEMENT_STATES } from "@/lib/announcements";
import { adminRoute, parseQuery } from "@/lib/cms/api";
import { adminId, announcementWrite } from "@/lib/cms/announcement-api";
import { announcementCounts, announcementInput, createAnnouncement, listAnnouncements } from "@/lib/cms/announcements";

const query = z.object({
  state: z.enum(ANNOUNCEMENT_STATES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = adminRoute(async (req) => {
  const q = parseQuery(req, query);
  if ("error" in q) return q.error;
  const [{ items, total }, counts] = await Promise.all([listAnnouncements(q.data), announcementCounts()]);
  return json(200, { announcements: items, total, counts });
});

/** Saves a draft, or publishes right away (or at publishAt when it is in the future). */
export const POST = adminRoute(async (req) => {
  const parsed = await parseBody(req, announcementInput.extend({ publish: z.boolean().default(false) }));
  if ("error" in parsed) return parsed.error;
  const by = await adminId(req);
  if (!by) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const { publish, ...input } = parsed.data;
  return announcementWrite(async () => json(201, { announcement: await createAnnouncement(input, by, publish) }));
});
