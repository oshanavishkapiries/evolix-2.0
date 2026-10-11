import { z } from "zod";
import { json } from "@/lib/auth/http";
import { adminRoute, parseQuery } from "@/lib/cms/api";
import { listReports } from "@/lib/cms/reports";
import { REPORT_STATUSES } from "@/lib/reports";

const query = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = adminRoute(async (req) => {
  const q = parseQuery(req, query);
  if ("error" in q) return q.error;
  const { items, total } = await listReports(q.data);
  return json(200, { reports: items, total });
});
