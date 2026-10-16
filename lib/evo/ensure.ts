import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, movies, seasons } from "@/db/schema";
import { createShowTree, findShowIdByTmdb } from "@/lib/cms/shows";
import { findMovieIdByTmdb } from "@/lib/cms/movies";
import { getMovieDetails, getShowDetails, type ShowPrefill } from "@/lib/tmdb";
import { audienceFromGenres } from "./audience";

/**
 * Evo titles live in the catalog tables as identity anchors (progress, bookmarks, reports, cached sources).
 * Rows are created on first use, published, and carry no sources until the pipeline caches a file.
 */

const pgCode = (e: unknown): string | undefined => {
  for (let cur = e as { code?: unknown; cause?: unknown } | undefined, i = 0; cur && i < 4; i++) {
    if (typeof cur.code === "string" && /^\d{5}$/.test(cur.code)) return cur.code;
    cur = cur.cause as typeof cur;
  }
};

/** Movie row id for a TMDB id, creating it from TMDB when missing. Throws TmdbError when TMDB has no such title. */
export async function ensureMovie(tmdbId: number): Promise<string> {
  const existing = await findMovieIdByTmdb(tmdbId);
  if (existing) return existing;

  const m = await getMovieDetails(tmdbId);
  await db
    .insert(movies)
    .values({
      tmdbId: m.tmdbId,
      title: m.title,
      originalTitle: m.originalTitle,
      tagline: m.tagline,
      overview: m.overview,
      releaseDate: m.releaseDate,
      runtimeMinutes: m.runtimeMinutes,
      genres: m.genres,
      rating: m.rating,
      voteCount: m.voteCount,
      originalLanguage: m.originalLanguage,
      status: m.status,
      posterPath: m.posterPath,
      backdropPath: m.backdropPath,
      logoPath: m.logoPath,
      galleryBackdrops: m.galleryBackdrops,
      cast: m.cast,
      isPublished: true,
      audience: audienceFromGenres(m.genres, m.certification),
    })
    .onConflictDoNothing({ target: movies.tmdbId });
  const id = await findMovieIdByTmdb(tmdbId);
  if (!id) throw new Error(`Could not create movie for TMDB ${tmdbId}`);
  return id;
}

async function createShow(prefill: ShowPrefill): Promise<string> {
  try {
    return await createShowTree({
      tmdbId: prefill.tmdbId,
      name: prefill.name,
      originalName: prefill.originalName,
      tagline: prefill.tagline,
      overview: prefill.overview,
      firstAirDate: prefill.firstAirDate,
      lastAirDate: prefill.lastAirDate,
      status: prefill.status,
      genres: prefill.genres,
      rating: prefill.rating,
      voteCount: prefill.voteCount,
      originalLanguage: prefill.originalLanguage,
      posterPath: prefill.posterPath,
      backdropPath: prefill.backdropPath,
      logoPath: prefill.logoPath,
      galleryBackdrops: prefill.galleryBackdrops,
      cast: prefill.cast,
      isPublished: true,
      audience: audienceFromGenres(prefill.genres, prefill.certification),
      seasons: prefill.seasons.map(({ episodes: eps, ...s }) => ({ ...s, episodes: eps })),
      videos: [],
    });
  } catch (e) {
    // Another request created the same show first (unique tmdb_id): use theirs.
    if (pgCode(e) !== "23505") throw e;
    const id = await findShowIdByTmdb(prefill.tmdbId);
    if (!id) throw e;
    return id;
  }
}

/** Show row id for a TMDB id, creating it with every season/episode when missing. */
export async function ensureShow(tmdbId: number): Promise<string> {
  const existing = await findShowIdByTmdb(tmdbId);
  if (existing) return existing;
  return createShow(await getShowDetails(tmdbId));
}

async function findEpisodeId(showId: string, seasonNumber: number, episodeNumber: number) {
  const [row] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
    .where(and(eq(seasons.showId, showId), eq(seasons.seasonNumber, seasonNumber), eq(episodes.episodeNumber, episodeNumber)))
    .limit(1);
  return row?.id ?? null;
}

/** Adds seasons/episodes TMDB has but the DB lacks (episodes that aired after the show was first synced). */
async function syncMissingEpisodes(showId: string, tmdbId: number) {
  const prefill = await getShowDetails(tmdbId);
  for (const s of prefill.seasons) {
    const [row] = await db
      .insert(seasons)
      .values({ showId, tmdbId: s.tmdbId, seasonNumber: s.seasonNumber, name: s.name, overview: s.overview, airDate: s.airDate, posterPath: s.posterPath, isVisible: s.isVisible })
      .onConflictDoNothing()
      .returning({ id: seasons.id });
    const seasonId =
      row?.id ??
      (await db.select({ id: seasons.id }).from(seasons).where(and(eq(seasons.showId, showId), eq(seasons.seasonNumber, s.seasonNumber))).limit(1))[0]?.id;
    if (!seasonId || !s.episodes.length) continue;
    await db
      .insert(episodes)
      .values(s.episodes.map((e) => ({ ...e, seasonId })))
      .onConflictDoNothing();
  }
}

/** Episode row id (and its show id) for a TMDB show/season/episode; null when TMDB has no such episode. */
export async function ensureEpisode(showTmdbId: number, seasonNumber: number, episodeNumber: number): Promise<{ showId: string; episodeId: string } | null> {
  const showId = await ensureShow(showTmdbId);
  let episodeId = await findEpisodeId(showId, seasonNumber, episodeNumber);
  if (!episodeId) {
    await syncMissingEpisodes(showId, showTmdbId);
    episodeId = await findEpisodeId(showId, seasonNumber, episodeNumber);
  }
  return episodeId ? { showId, episodeId } : null;
}

