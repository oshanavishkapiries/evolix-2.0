import { and, asc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { catalogCache } from "./cache";
import { normalizeSource } from "@/lib/viewer/providers";
import { episodes, movies, seasons, shows, sources, subtitles } from "@/db/schema";

export type WatchSource = {
  id: string;
  label: string;
  kind: "direct" | "hls" | "embed";
  quality: string | null;
  url: string;
};
export type WatchSubtitle = {
  id: string;
  label: string;
  language: string;
  format: "vtt" | "srt";
  url: string;
};

const activeSources = async (where: ReturnType<typeof eq>): Promise<WatchSource[]> =>
  (await db
    .select({ id: sources.id, label: sources.label, kind: sources.kind, quality: sources.quality, url: sources.url })
    .from(sources)
    .where(and(where, eq(sources.isActive, true)))
    .orderBy(asc(sources.sortOrder), asc(sources.createdAt))).map(normalizeSource);

const subtitleRows = (where: ReturnType<typeof eq>) =>
  db
    .select({
      id: subtitles.id,
      label: subtitles.label,
      language: subtitles.language,
      format: subtitles.format,
      url: subtitles.url,
    })
    .from(subtitles)
    .where(where)
    .orderBy(asc(subtitles.sortOrder), asc(subtitles.createdAt));

/** Published movie with its active sources and subtitles; null when missing or unpublished. */
export const getMovieWatch = cache(async (id: string) => {
  "use cache";
  catalogCache();
  const [[movie], srcs, subs] = await Promise.all([
    db
      .select({ id: movies.id, title: movies.title, releaseDate: movies.releaseDate, backdropPath: movies.backdropPath, overview: movies.overview, runtimeMinutes: movies.runtimeMinutes, rating: movies.rating })
      .from(movies)
      .where(and(eq(movies.id, id), eq(movies.isPublished, true)))
      .limit(1),
    activeSources(eq(sources.movieId, id)),
    subtitleRows(eq(subtitles.movieId, id)),
  ]);
  return movie ? { ...movie, sources: srcs, subtitles: subs } : null;
});

export type EpisodeRef = { seasonNumber: number; episodeNumber: number; name: string };

/**
 * Episode page data. Prev/next cross season boundaries and consider visible episodes only.
 * Null when the show is unpublished or the season/episode is missing or hidden.
 */
export const getEpisodeWatch = cache(async (showId: string, seasonNumber: number, episodeNumber: number) => {
  "use cache";
  catalogCache();
  const list = await db
    .select({
      id: episodes.id,
      showName: shows.name,
      backdropPath: shows.backdropPath,
      seasonNumber: seasons.seasonNumber,
      seasonName: seasons.name,
      episodeNumber: episodes.episodeNumber,
      name: episodes.name,
      overview: episodes.overview,
      airDate: episodes.airDate,
      runtimeMinutes: episodes.runtimeMinutes,
      stillPath: episodes.stillPath,
    })
    .from(episodes)
    .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
    .innerJoin(shows, eq(shows.id, seasons.showId))
    .where(
      and(eq(shows.id, showId), eq(shows.isPublished, true), eq(seasons.isVisible, true), eq(episodes.isVisible, true)),
    )
    .orderBy(asc(seasons.seasonNumber), asc(episodes.episodeNumber));

  const i = list.findIndex((e) => e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber);
  if (i < 0) return null;
  const current = list[i];
  const ref = (e?: (typeof list)[number]): EpisodeRef | null =>
    e ? { seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber, name: e.name } : null;

  const [srcs, subs] = await Promise.all([
    activeSources(eq(sources.episodeId, current.id)),
    subtitleRows(eq(subtitles.episodeId, current.id)),
  ]);
  return {
    current,
    prev: ref(list[i - 1]),
    next: ref(list[i + 1]),
    seasonEpisodes: list.filter((e) => e.seasonNumber === seasonNumber),
    sources: srcs,
    subtitles: subs,
  };
});
