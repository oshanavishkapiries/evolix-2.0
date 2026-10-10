import { json } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { commitPlan, planFromRequest } from "@/lib/cms/provider-io";

/** Re-plans the same file and inserts only the rows that are new; duplicates and errors are skipped. */
export const POST = adminRoute(async (req) => {
  const result = await planFromRequest(req);
  if ("error" in result) return result.error;
  const { plan } = result;
  await commitPlan(plan);
  return json(200, {
    imported: { sources: plan.summary.sourcesNew, subtitles: plan.summary.subtitlesNew },
    skipped: plan.summary.duplicates,
    errors: plan.summary.errors,
  });
});
