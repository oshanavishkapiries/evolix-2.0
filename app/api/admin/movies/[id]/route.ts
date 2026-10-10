import { eq } from "drizzle-orm";
import { db } from "@/db";
import { movies } from "@/db/schema";
import { json } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound, parsePatch } from "@/lib/cms/api";
import { getMovie } from "@/lib/cms/movies";
import { moviePatch } from "@/lib/cms/schemas";
import { listVideos } from "@/lib/cms/videos";

type P = { id: string };

export const GET = adminRoute<P>(async (_req, { id }) => {
  const movie = isUuid(id) ? await getMovie(id) : null;
  return movie ? json(200, { movie: { ...movie, videos: await listVideos({ movieId: id }) } }) : notFound("Movie");
});

export const PATCH = adminRoute<P>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Movie");
  const body = await parsePatch(req, moviePatch);
  if ("error" in body) return body.error;
  const [row] = await db
    .update(movies)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(movies.id, id))
    .returning();
  return row ? json(200, { movie: row }) : notFound("Movie");
});

export const DELETE = adminRoute<P>(async (_req, { id }) => {
  if (!isUuid(id)) return notFound("Movie");
  const rows = await db.delete(movies).where(eq(movies.id, id)).returning({ id: movies.id });
  return rows.length ? json(200, {}) : notFound("Movie");
});
