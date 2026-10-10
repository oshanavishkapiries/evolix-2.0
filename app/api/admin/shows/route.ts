import { fail, json, parseBody } from "@/lib/auth/http";
import { adminRoute, parseQuery } from "@/lib/cms/api";
import { listQuery } from "@/lib/cms/search";
import { showCreate } from "@/lib/cms/schemas";
import { createShowTree, findShowIdByTmdb, listShows } from "@/lib/cms/shows";

export const GET = adminRoute(async (req) => {
  const q = parseQuery(req, listQuery);
  if ("error" in q) return q.error;
  const { rows, total, page, pageSize } = await listShows(q.data);
  return json(200, { shows: rows, total, page, pageSize });
});

export const POST = adminRoute(async (req) => {
  const body = await parseBody(req, showCreate);
  if ("error" in body) return body.error;
  const existing = await findShowIdByTmdb(body.data.tmdbId);
  if (existing) return fail(409, "ALREADY_EXISTS", "This show was already added", { id: existing });
  return json(201, { id: await createShowTree(body.data) });
});
