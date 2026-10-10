import { json } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound } from "@/lib/cms/api";
import { MAX_PREVIEW_ROWS, planFromRequest } from "@/lib/cms/provider-io";

/** Dry run: validates and plans the file against this show, writes nothing. */
export const POST = adminRoute<{ id: string }>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Show");
  const result = await planFromRequest(req, { type: "show", id }, () => notFound("Show"));
  if ("error" in result) return result.error;
  const { summary, rows } = result.plan;
  return json(200, { summary, rows: rows.slice(0, MAX_PREVIEW_ROWS), truncated: rows.length > MAX_PREVIEW_ROWS });
});
