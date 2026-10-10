import { eq } from "drizzle-orm";
import { db } from "@/db";
import { movies, shows } from "@/db/schema";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute, notFound } from "@/lib/cms/api";
import { videoImport } from "@/lib/cms/schemas";
import { addVideos } from "@/lib/cms/videos";
import { getTmdbVideos } from "@/lib/tmdb";

/** Fetches the title's videos from TMDB and inserts the ones not stored yet. */
export const POST = adminRoute(async (req) => {
  const body = await parseBody(req, videoImport);
  if ("error" in body) return body.error;
  const { movieId, showId } = body.data;

  const [parent] = movieId
    ? await db.select({ tmdbId: movies.tmdbId }).from(movies).where(eq(movies.id, movieId)).limit(1)
    : await db.select({ tmdbId: shows.tmdbId }).from(shows).where(eq(shows.id, showId!)).limit(1);
  if (!parent) return notFound(movieId ? "Movie" : "Show");

  const found = await getTmdbVideos(movieId ? "movie" : "tv", parent.tmdbId);
  const added = await addVideos(
    movieId ? { movieId } : { showId: showId! },
    found.map((v) => ({ ...v, isVisible: true })),
  );
  return json(200, { added, skipped: found.length - added });
});
