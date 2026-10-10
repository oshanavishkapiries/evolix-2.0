import { fail, json, parseBody } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { showCreate } from "@/lib/cms/schemas";
import { createShowTree, findShowIdByTmdb, listShows } from "@/lib/cms/shows";

export const GET = adminRoute(async () => json(200, { shows: await listShows() }));

export const POST = adminRoute(async (req) => {
  const body = await parseBody(req, showCreate);
  if ("error" in body) return body.error;
  const existing = await findShowIdByTmdb(body.data.tmdbId);
  if (existing) return fail(409, "ALREADY_EXISTS", "This show was already added", { id: existing });
  return json(201, { id: await createShowTree(body.data) });
});
