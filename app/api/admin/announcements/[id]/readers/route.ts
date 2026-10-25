import { z } from "zod";
import { json } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound, parseQuery } from "@/lib/cms/api";
import { listReaders } from "@/lib/cms/announcements";

const query = z.object({
  kind: z.enum(["read", "unread"]).default("read"),
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Who has (or has not) read an announcement, among the people it was addressed to. */
export const GET = adminRoute<{ id: string }>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Announcement");
  const q = parseQuery(req, query);
  if ("error" in q) return q.error;
  const res = await listReaders(id, q.data);
  return res ? json(200, res) : notFound("Announcement");
});
