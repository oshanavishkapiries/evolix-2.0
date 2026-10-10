import { eq, max } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute, parseQuery } from "@/lib/cms/api";
import { videoCreate, videoParentQuery } from "@/lib/cms/schemas";
import { listVideos } from "@/lib/cms/videos";

export const GET = adminRoute(async (req) => {
  const q = parseQuery(req, videoParentQuery);
  if ("error" in q) return q.error;
  const { movieId, showId } = q.data;
  return json(200, { videos: await listVideos(movieId ? { movieId } : { showId: showId! }) });
});

// A missing parent surfaces as a foreign-key violation (404) and a duplicate
// site+key as a unique violation (409); both are mapped by adminRoute.
export const POST = adminRoute(async (req) => {
  const body = await parseBody(req, videoCreate);
  if ("error" in body) return body.error;
  const { publishedAt, sortOrder, ...rest } = body.data;
  let order = sortOrder;
  if (order === undefined) {
    const parentCol = rest.movieId ? eq(videos.movieId, rest.movieId) : eq(videos.showId, rest.showId!);
    const [{ top }] = await db.select({ top: max(videos.sortOrder) }).from(videos).where(parentCol);
    order = top === null ? 0 : top + 1;
  }
  const [row] = await db
    .insert(videos)
    .values({ ...rest, sortOrder: order, publishedAt: publishedAt ? new Date(publishedAt) : null })
    .returning();
  return json(201, { video: row });
});
