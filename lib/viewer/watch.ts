import { and, asc, desc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { cacheTag } from "next/cache";
import { db } from "@/db";
import { catalogCache, titleTag, tmdbTag } from "./cache";
import { episodeNeighbors, isUpcoming } from "./availability";
import { airedEpisode } from "./availability-query";
import { viewerFileUrl } from "@/lib/evo/stream-url";
import { normalizeSource } from "@/lib/viewer/providers";
import { episodes, movies, seasons, shows, sources, subtitles } from "@/db/schema";
import { parseMediaId } from "./ids";
import { findMovieIdByTmdb } from "@/lib/cms/movies";
import { findShowIdByTmdb } from "@/lib/cms/shows";
import { getMovieSummary, getShowSummary, getShowSeason } from "@/lib/tmdb";

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
  source?: "auto" | "opensubtitles" | "upload" | "translation";
  originTrackId?: string | null;
  visibility?: "private" | "shared";
  score?: number;
  lastUsedAt?: string | Date | null;
  canShare?: boolean;
};

const activeSources = async (where: ReturnType<typeof eq>): Promise<WatchSource[]> =>
  Promise.all((await db
    .select({ id: sources.id, label: sources.label, kind: sources.kind, quality: sources.quality, url: sources.url, engineId: sources.engineId, audioLanguage: sources.audioLanguage })
    .from(sources)
    .where(and(where, eq(sources.isActive, true)))
    .orderBy(asc(sources.sortOrder), asc(sources.createdAt))).map(async ({ engineId, ...s }) => normalizeSource({ ...s, url: await viewerFileUrl(s.url, engineId) })));

const subtitleRows = async (where: ReturnType<typeof eq>): Promise<WatchSubtitle[]> =>
  Promise.all((await db
    .select({
      engineId: subtitles.engineId,
      id: subtitles.id,
      label: subtitles.label,
      language: subtitles.language,
      format: subtitles.format,
      url: subtitles.url,
      source: subtitles.source,
      originTrackId: subtitles.originTrackId,
      score: subtitles.score,
    })
    .from(subtitles)
    .where(and(where, eq(subtitles.visibility, "shared"), eq(subtitles.hidden, false)))
    .orderBy(desc(subtitles.score), sql`${subtitles.lastUsedAt} desc nulls last`, asc(subtitles.id))).map(async ({ engineId, ...s }) => ({ ...s, url: await viewerFileUrl(s.url, engineId) })));

async function getDbMovieWatch(id: string) {
  cacheTag(titleTag("movie", id));
  const [[movie], srcs, subs] = await Promise.all([
    db
      .select({ id: movies.id, tmdbId: movies.tmdbId, title: movies.title, releaseDate: movies.releaseDate, backdropPath: movies.backdropPath, overview: movies.overview, runtimeMinutes: movies.runtimeMinutes, rating: movies.rating })
      .from(movies)
      .where(and(eq(movies.id, id), eq(movies.isPublished, true)))
      .limit(1),
    activeSources(eq(sources.movieId, id)),
    subtitleRows(eq(subtitles.movieId, id)),
  ]);
  if (movie?.tmdbId) cacheTag(tmdbTag("movie", movie.tmdbId));
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
    cacheTag(tmdbTag("movie", media.tmdbId));
    const localId = await findMovieIdByTmdb(media.tmdbId);
    if (localId) {
      const localWatch = await getDbMovieWatch(localId);
      if (localWatch && localWatch.sources.length > 0) return localWatch;
    }

    try {
      const tmdbMovie = await getMovieSummary(media.tmdbId, "watch");
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

/** Reuse the lightweight sidebar across every episode in this season. */
async function getDbSeasonSidebar(showId: string, seasonId: string) {
  "use cache";
  catalogCache();
  cacheTag(titleTag("show", showId));
  return db.select({ id: episodes.id, episodeNumber: episodes.episodeNumber, name: episodes.name,
    airDate: episodes.airDate, runtimeMinutes: episodes.runtimeMinutes, stillPath: episodes.stillPath })
    .from(episodes).where(and(eq(episodes.seasonId, seasonId), eq(episodes.isVisible, true)))
    .orderBy(asc(episodes.episodeNumber));
}

async function getDbEpisodeWatch(showId: string, seasonNumber: number, episodeNumber: number) {
  cacheTag(titleTag("show", showId));
  const [current] = await db
    .select({
      id: episodes.id,
      seasonId: seasons.id,
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
      and(eq(shows.id, showId), eq(shows.isPublished, true), eq(seasons.isVisible, true), eq(episodes.isVisible, true), eq(seasons.seasonNumber, seasonNumber), eq(episodes.episodeNumber, episodeNumber)),
    )
    .limit(1);
  if (!current) return null;
  if (current.tmdbId) cacheTag(tmdbTag("tv", current.tmdbId));

  const neighbor = async (direction: "prev" | "next"): Promise<EpisodeRef | null> => {
    if (isUpcoming(current.airDate)) return null;
    const compare = direction === "prev" ? sql`<` : sql`>`;
    const order = direction === "prev" ? desc : asc;
    const [row] = await db.select({ seasonNumber: seasons.seasonNumber, episodeNumber: episodes.episodeNumber, name: episodes.name })
      .from(seasons).innerJoin(episodes, eq(episodes.seasonId, seasons.id))
      .where(and(eq(seasons.showId, showId), eq(seasons.isVisible, true), eq(episodes.isVisible, true), airedEpisode(),
        sql`(${seasons.seasonNumber}, ${episodes.episodeNumber}) ${compare} (${seasonNumber}, ${episodeNumber})`))
      .orderBy(order(seasons.seasonNumber), order(episodes.episodeNumber)).limit(1);
    return row ?? null;
  };
  const [srcs, subs, seasonEpisodes, prev, next] = await Promise.all([
    activeSources(eq(sources.episodeId, current.id)),
    subtitleRows(eq(subtitles.episodeId, current.id)),
    getDbSeasonSidebar(showId, current.seasonId),
    neighbor("prev"), neighbor("next"),
  ]);
  return {
    current,
    prev,
    next,
    seasonEpisodes: seasonEpisodes.map((episode) => ({ ...current, ...episode, overview: undefined })),
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
    cacheTag(tmdbTag("tv", media.tmdbId));
    const localId = await findShowIdByTmdb(media.tmdbId);
    if (localId) {
      const localWatch = await getDbEpisodeWatch(localId, seasonNumber, episodeNumber);
      if (localWatch && localWatch.sources.length > 0) return localWatch;
    }

    try {
      const [s, season] = await Promise.all([getShowSummary(media.tmdbId, "watch"), getShowSeason(media.tmdbId, seasonNumber)]);
      const mapEpisode = (ep: (typeof season)[number], secNumber: number, secName: string) => ({
        id: `tmdb-ep-${media.tmdbId}-${secNumber}-${ep.episodeNumber}`,
        showName: s.name, backdropPath: s.backdropPath, seasonId: `tmdb-season-${media.tmdbId}-${secNumber}`,
        seasonNumber: secNumber, seasonName: secName, episodeNumber: ep.episodeNumber,
        name: ep.name, overview: ep.overview, airDate: ep.airDate, runtimeMinutes: ep.runtimeMinutes,
        stillPath: ep.stillPath, tmdbId: media.tmdbId,
      });
      const sec = s.seasons.find((v) => v.seasonNumber === seasonNumber);
      if (!sec) return null;
      const allEpisodes = season.map((ep) => mapEpisode(ep, seasonNumber, sec.name));
      const current = allEpisodes.find((e) => e.episodeNumber === episodeNumber);
      if (!current) return null;
      const neighbors = episodeNeighbors(allEpisodes, current);
      const ref = (e: EpisodeRef | null): EpisodeRef | null =>
        e ? { seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber, name: e.name } : null;
      // Only fetch an adjacent aired season when navigation actually reaches a boundary.
      if (!isUpcoming(current.airDate)) {
        const ordered = s.seasons.filter((v) => v.episodeCount > 0 && !isUpcoming(v.airDate))
          .sort((a, b) => a.seasonNumber - b.seasonNumber);
        const previous = ordered.filter((v) => v.seasonNumber < seasonNumber).at(-1);
        const next = ordered.find((v) => v.seasonNumber > seasonNumber);
        const adjacent = async (v: typeof sec | undefined, last: boolean) => {
          if (!v) return null;
          const eps = (await getShowSeason(media.tmdbId, v.seasonNumber).catch(() => [])).filter((e) => !isUpcoming(e.airDate));
          const ep = last ? eps.at(-1) : eps[0];
          return ep ? mapEpisode(ep, v.seasonNumber, v.name) : null;
        };
        const [prevEdge, nextEdge] = await Promise.all([
          !neighbors.prev ? adjacent(previous, true) : null,
          !neighbors.next ? adjacent(next, false) : null,
        ]);
        neighbors.prev ??= prevEdge;
        neighbors.next ??= nextEdge;
      }
      return {
        current,
        prev: ref(neighbors.prev),
        next: ref(neighbors.next),
        seasonEpisodes: allEpisodes.map((e) => ({ ...e, overview: undefined })),
        sources: [] as WatchSource[],
        subtitles: [] as WatchSubtitle[],
      };
    } catch {
      return null;
    }
  }

  return getDbEpisodeWatch(media.id, seasonNumber, episodeNumber);
});
