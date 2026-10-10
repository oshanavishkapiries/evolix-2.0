import { and, asc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { episodes, movies, seasons, shows, sources, videos } from "@/db/schema";

// Viewer reads: published titles, visible seasons/episodes/videos, active sources only.

const visibleVideos = (parent: { movieId: string } | { showId: string }) =>
  db
    .select({ id: videos.id, site: videos.site, key: videos.key, name: videos.name, type: videos.type })
    .from(videos)
    .where(
      and(
        "movieId" in parent ? eq(videos.movieId, parent.movieId) : eq(videos.showId, parent.showId),
        eq(videos.isVisible, true),
      ),
    )
    .orderBy(asc(videos.sortOrder), asc(videos.createdAt));

/** First visible episode of a show (specials, season 0, come last). */
export async function firstEpisode(showId: string) {
  const [row] = await db
    .select({ seasonNumber: seasons.seasonNumber, episodeNumber: episodes.episodeNumber })
    .from(episodes)
    .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
    .where(and(eq(seasons.showId, showId), eq(seasons.isVisible, true), eq(episodes.isVisible, true)))
    .orderBy(sql`${seasons.seasonNumber} = 0`, asc(seasons.seasonNumber), asc(episodes.episodeNumber))
    .limit(1);
  return row ?? null;
}

export type MovieDetail = NonNullable<Awaited<ReturnType<typeof getMovieDetail>>>;

/** Published movie with its visible videos; null when missing or unpublished. */
export const getMovieDetail = cache(async (id: string) => {
  const [[movie], vids, [src]] = await Promise.all([
    db
      .select({
        id: movies.id,
        title: movies.title,
        tagline: movies.tagline,
        overview: movies.overview,
        releaseDate: movies.releaseDate,
        runtimeMinutes: movies.runtimeMinutes,
        genres: movies.genres,
        rating: movies.rating,
        posterPath: movies.posterPath,
        backdropPath: movies.backdropPath,
        logoPath: movies.logoPath,
        galleryBackdrops: movies.galleryBackdrops,
        cast: movies.cast,
      })
      .from(movies)
      .where(and(eq(movies.id, id), eq(movies.isPublished, true)))
      .limit(1),
    visibleVideos({ movieId: id }),
    db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.movieId, id), eq(sources.isActive, true)))
      .limit(1),
  ]);
  return movie ? { ...movie, videos: vids, playable: Boolean(src) } : null;
});

export type ShowDetail = NonNullable<Awaited<ReturnType<typeof getShowDetail>>>;

/** Published show with visible seasons; episodes are for the selected season only. */
export const getShowDetail = cache(async (id: string, seasonNumber: number | null) => {
  const [[show], vids, seasonRows, first] = await Promise.all([
    db
      .select({
        id: shows.id,
        title: shows.name,
        tagline: shows.tagline,
        overview: shows.overview,
        firstAirDate: shows.firstAirDate,
        lastAirDate: shows.lastAirDate,
        status: shows.status,
        genres: shows.genres,
        rating: shows.rating,
        posterPath: shows.posterPath,
        backdropPath: shows.backdropPath,
        logoPath: shows.logoPath,
        galleryBackdrops: shows.galleryBackdrops,
        cast: shows.cast,
      })
      .from(shows)
      .where(and(eq(shows.id, id), eq(shows.isPublished, true)))
      .limit(1),
    visibleVideos({ showId: id }),
    db
      .select({
        id: seasons.id,
        seasonNumber: seasons.seasonNumber,
        name: seasons.name,
        overview: seasons.overview,
        airDate: seasons.airDate,
        posterPath: seasons.posterPath,
      })
      .from(seasons)
      .where(and(eq(seasons.showId, id), eq(seasons.isVisible, true)))
      .orderBy(asc(seasons.seasonNumber)),
    firstEpisode(id),
  ]);
  if (!show) return null;

  const selected =
    seasonRows.find((s) => s.seasonNumber === seasonNumber) ??
    seasonRows.find((s) => s.seasonNumber === first?.seasonNumber) ??
    seasonRows[0] ??
    null;
  const eps = selected
    ? await db
        .select({
          id: episodes.id,
          episodeNumber: episodes.episodeNumber,
          name: episodes.name,
          overview: episodes.overview,
          airDate: episodes.airDate,
          runtimeMinutes: episodes.runtimeMinutes,
          stillPath: episodes.stillPath,
        })
        .from(episodes)
        .where(and(eq(episodes.seasonId, selected.id), eq(episodes.isVisible, true)))
        .orderBy(asc(episodes.episodeNumber))
    : [];
  return { ...show, videos: vids, seasons: seasonRows, selected, episodes: eps, first };
});
