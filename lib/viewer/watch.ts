import { and, asc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { catalogCache } from "./cache";
import { normalizeSource } from "@/lib/viewer/providers";
import { episodes, movies, seasons, shows, sources, subtitles } from "@/db/schema";
import { parseMediaId } from "./ids";
import { findMovieIdByTmdb } from "@/lib/cms/movies";
import { findShowIdByTmdb } from "@/lib/cms/shows";
import { getMovieDetails, getShowDetails } from "@/lib/tmdb";

export type WatchSource = {
  id: string;
  label: string;
  kind: "direct" | "hls" | "embed";
  quality: string | null;
  url: string;
  /** Dub language code ("si", "en", ...); empty when not specified. */
  audioLanguage: string;
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
    .select({ id: sources.id, label: sources.label, kind: sources.kind, quality: sources.quality, url: sources.url, audioLanguage: sources.audioLanguage })
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

async function getDbMovieWatch(id: string) {
  const [[movie], srcs, subs] = await Promise.all([
    db
      .select({ id: movies.id, tmdbId: movies.tmdbId, title: movies.title, releaseDate: movies.releaseDate, backdropPath: movies.backdropPath, overview: movies.overview, runtimeMinutes: movies.runtimeMinutes, rating: movies.rating })
      .from(movies)
      .where(and(eq(movies.id, id), eq(movies.isPublished, true)))
      .limit(1),
    activeSources(eq(sources.movieId, id)),
    subtitleRows(eq(subtitles.movieId, id)),
  ]);
  return movie ? { ...movie, sources: srcs, subtitles: subs } : null;
}

export type MovieWatch = NonNullable<Awaited<ReturnType<typeof getDbMovieWatch>>>;

/** Published movie with its active sources and subtitles; null when missing or unpublished. */
export const getMovieWatch = cache(async (id: string): Promise<MovieWatch | null> => {
  "use cache";
  catalogCache();

  const media = parseMediaId(id);
  if (!media) return null;

  if (media.kind === "tmdb") {
    const localId = await findMovieIdByTmdb(media.tmdbId);
    if (localId) {
      const localWatch = await getDbMovieWatch(localId);
      if (localWatch && localWatch.sources.length > 0) return localWatch;
    }

    try {
      const tmdbMovie = await getMovieDetails(media.tmdbId);
      return {
        id: `tmdb-${media.tmdbId}`,
        tmdbId: media.tmdbId,
        title: tmdbMovie.title,
        releaseDate: tmdbMovie.releaseDate,
        backdropPath: tmdbMovie.backdropPath,
        overview: tmdbMovie.overview,
        runtimeMinutes: tmdbMovie.runtimeMinutes,
        rating: tmdbMovie.rating,
        sources: [] as WatchSource[],
        subtitles: [] as WatchSubtitle[],
      };
    } catch {
      return null;
    }
  }

  return getDbMovieWatch(media.id);
});

export type EpisodeRef = { seasonNumber: number; episodeNumber: number; name: string };

async function getDbEpisodeWatch(showId: string, seasonNumber: number, episodeNumber: number) {
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
      tmdbId: shows.tmdbId,
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
}

export type EpisodeWatch = NonNullable<Awaited<ReturnType<typeof getDbEpisodeWatch>>>;

/**
 * Episode page data. Prev/next cross season boundaries and consider visible episodes only.
 * Null when the show is unpublished or the season/episode is missing or hidden.
 */
export const getEpisodeWatch = cache(async (showId: string, seasonNumber: number, episodeNumber: number): Promise<EpisodeWatch | null> => {
  "use cache";
  catalogCache();

  const media = parseMediaId(showId);
  if (!media) return null;

  if (media.kind === "tmdb") {
    const localId = await findShowIdByTmdb(media.tmdbId);
    if (localId) {
      const localWatch = await getDbEpisodeWatch(localId, seasonNumber, episodeNumber);
      if (localWatch && localWatch.sources.length > 0) return localWatch;
    }

    try {
      const s = await getShowDetails(media.tmdbId);
      const allEpisodes: Array<{
        id: string;
        showName: string;
        backdropPath: string | null;
        seasonNumber: number;
        seasonName: string;
        episodeNumber: number;
        name: string;
        overview: string;
        airDate: string | null;
        runtimeMinutes: number | null;
        stillPath: string | null;
        tmdbId: number;
      }> = [];

      for (const sec of s.seasons) {
        for (const ep of sec.episodes ?? []) {
          allEpisodes.push({
            id: `tmdb-ep-${media.tmdbId}-${sec.seasonNumber}-${ep.episodeNumber}`,
            showName: s.name,
            backdropPath: s.backdropPath,
            seasonNumber: sec.seasonNumber,
            seasonName: sec.name,
            episodeNumber: ep.episodeNumber,
            name: ep.name,
            overview: ep.overview,
            airDate: ep.airDate,
            runtimeMinutes: ep.runtimeMinutes,
            stillPath: ep.stillPath,
            tmdbId: media.tmdbId,
          });
        }
      }

      const i = allEpisodes.findIndex((e) => e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber);
      if (i < 0) return null;
      const current = allEpisodes[i];
      const ref = (e?: (typeof allEpisodes)[number]): EpisodeRef | null =>
        e ? { seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber, name: e.name } : null;

      return {
        current,
        prev: ref(allEpisodes[i - 1]),
        next: ref(allEpisodes[i + 1]),
        seasonEpisodes: allEpisodes.filter((e) => e.seasonNumber === seasonNumber),
        sources: [] as WatchSource[],
        subtitles: [] as WatchSubtitle[],
      };
    } catch {
      return null;
    }
  }

  return getDbEpisodeWatch(media.id, seasonNumber, episodeNumber);
});
