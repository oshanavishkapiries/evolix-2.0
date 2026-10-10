import { json } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { MAX_PREVIEW_ROWS, planFromRequest } from "@/lib/cms/provider-io";

/** Dry run: validates and plans the file, writes nothing. */
export const POST = adminRoute(async (req) => {
  const result = await planFromRequest(req);
  if ("error" in result) return result.error;
  const { summary, rows } = result.plan;
  return json(200, { summary, rows: rows.slice(0, MAX_PREVIEW_ROWS), truncated: rows.length > MAX_PREVIEW_ROWS });
});
