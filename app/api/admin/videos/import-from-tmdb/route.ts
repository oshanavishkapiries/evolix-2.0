import { eq } from "drizzle-orm";
import { db } from "@/db";
import { movies, shows } from "@/db/schema";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute, notFound } from "@/lib/cms/api";
import { videoImport } from "@/lib/cms/schemas";
import { addVideos, listVideos } from "@/lib/cms/videos";
import { getTmdbVideos } from "@/lib/tmdb";
import { DEFAULT_VIDEO_PICK, rankVideos } from "@/lib/videos";

/** Tops the title up to 5 videos with the best-ranked ones from TMDB that are not stored yet. */
export const POST = adminRoute(async (req) => {
  const body = await parseBody(req, videoImport);
  if ("error" in body) return body.error;
  const { movieId, showId } = body.data;

  const [parent] = movieId
    ? await db.select({ tmdbId: movies.tmdbId }).from(movies).where(eq(movies.id, movieId)).limit(1)
    : await db.select({ tmdbId: shows.tmdbId }).from(shows).where(eq(shows.id, showId!)).limit(1);
  if (!parent) return notFound(movieId ? "Movie" : "Show");

  const target = movieId ? { movieId } : { showId: showId! };
  const [found, existing] = await Promise.all([
    getTmdbVideos(movieId ? "movie" : "tv", parent.tmdbId),
    listVideos(target),
  ]);
  const have = new Set(existing.map((v) => `${v.site}:${v.key}`));
  const room = Math.max(0, DEFAULT_VIDEO_PICK - existing.length);
  const missing = found.filter((v) => !have.has(`${v.site}:${v.key}`));
  const best = rankVideos(missing, room);
  const added = best.length ? await addVideos(target, best.map((v, i) => ({ ...v, sortOrder: i, isVisible: true }))) : 0;
  return json(200, { added, skipped: found.length - added });
});
