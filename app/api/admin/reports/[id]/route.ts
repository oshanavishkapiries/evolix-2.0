import { z } from "zod";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound } from "@/lib/cms/api";
import { setReportStatus } from "@/lib/cms/reports";
import { REPORT_STATUSES } from "@/lib/reports";

const body = z.object({ status: z.enum(REPORT_STATUSES) });

/** Moves a report between open, resolved and dismissed. */
export const PATCH = adminRoute<{ id: string }>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Report");
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const row = await setReportStatus(id, parsed.data.status);
  return row ? json(200, { report: row }) : notFound("Report");
});
