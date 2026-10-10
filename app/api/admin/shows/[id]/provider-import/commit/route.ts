import { json } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound } from "@/lib/cms/api";
import { commitPlan, planFromRequest } from "@/lib/cms/provider-io";

/** Re-plans the same file and inserts only the new rows; duplicates, blanks and errors are skipped. */
export const POST = adminRoute<{ id: string }>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Show");
  const result = await planFromRequest(req, { type: "show", id }, () => notFound("Show"));
  if ("error" in result) return result.error;
  const { plan } = result;
  await commitPlan(plan);
  return json(200, {
    imported: { sources: plan.summary.sourcesNew, subtitles: plan.summary.subtitlesNew },
    skipped: plan.summary.duplicates,
    blank: plan.summary.blank,
    errors: plan.summary.errors,
  });
});
