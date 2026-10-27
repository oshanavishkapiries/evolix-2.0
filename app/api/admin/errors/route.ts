import { z } from "zod";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { deleteIssues, ISSUE_STATUSES, setIssueStatus } from "@/lib/errors/queries";

const ids = z.array(z.uuid()).min(1).max(500);

/** Bulk status change: resolve, ignore or reopen. */
export const PATCH = adminRoute(async (req) => {
  const parsed = await parseBody(req, z.object({ ids, status: z.enum(ISSUE_STATUSES) }));
  if ("error" in parsed) return parsed.error;
  return json(200, { updated: await setIssueStatus(parsed.data.ids, parsed.data.status) });
});

/** Bulk delete: issues with all their events and counts. A new occurrence opens a fresh issue. */
export const DELETE = adminRoute(async (req) => {
  const parsed = await parseBody(req, z.object({ ids }));
  if ("error" in parsed) return parsed.error;
  return json(200, { deleted: await deleteIssues(parsed.data.ids) });
});
