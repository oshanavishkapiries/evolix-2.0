import { and, asc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { cacheTag } from "next/cache";
import { db } from "@/db";
import { AUDIO_LANGUAGES } from "@/lib/audio";
import { catalogCache, titleTag, tmdbTag } from "./cache";
import { isUpcoming } from "./availability";
import { airedEpisode } from "./availability-query";
import { episodes, movies, seasons, shows, sources, videos } from "@/db/schema";
import { parseMediaId } from "./ids";
import { findMovieIdByTmdb } from "@/lib/cms/movies";
import { findShowIdByTmdb } from "@/lib/cms/shows";
import { getMovieSummary, getShowSummary, getShowSeason, getViewerTmdbVideos } from "@/lib/tmdb";

/** Language codes of a title's sources in display order, without the unspecified one. */
const dubCodes = (rows: { audioLanguage: string }[]) =>
  AUDIO_LANGUAGES.map((l) => l.code as string).filter((c) => rows.some((r) => r.audioLanguage === c));

type VideoRow = Awaited<ReturnType<typeof visibleVideos>>[number];

/** Titles Evo created on demand have no stored videos: fall back to TMDB's trailers so the Extras row is not empty. */
async function withTmdbVideos(stored: VideoRow[], kind: "movie" | "tv", tmdbId: number | null): Promise<VideoRow[]> {
  if (stored.length || !tmdbId) return stored;
  try {
    return (await getViewerTmdbVideos(kind, tmdbId)).map((v, i) => ({ id: `tmdb-vid-${i}`, site: v.site, key: v.key, name: v.name, type: v.type }));
  } catch {
    return stored;
  }
}

/** Await only in the optional extras boundary, after the title has been validated. */
export async function getDetailVideos(kind: "movie" | "tv", id: string, tmdbId: number | null, stored: VideoRow[]) {
  "use cache";
  catalogCache();
  cacheTag(titleTag(kind === "movie" ? "movie" : "show", id));
  if (tmdbId) cacheTag(tmdbTag(kind, tmdbId));
  return withTmdbVideos(stored, kind, tmdbId);
}

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
export async function firstEpisode(showId: string): Promise<{ seasonNumber: number; episodeNumber: number } | null> {
  const rows = await db
    .select({ seasonNumber: seasons.seasonNumber, episodeNumber: episodes.episodeNumber })
    .from(episodes)
    .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
    .where(and(eq(seasons.showId, showId), eq(seasons.isVisible, true), eq(episodes.isVisible, true), airedEpisode()))
    .orderBy(sql`${seasons.seasonNumber} = 0`, asc(seasons.seasonNumber), asc(episodes.episodeNumber))
    .limit(1);
  return rows[0] ?? null;
}

async function getDbMovieDetail(id: string) {
  cacheTag(titleTag("movie", id));
  const [[movie], vids, langs] = await Promise.all([
    db
      .select({
        id: movies.id,
        title: movies.title,
        originalTitle: movies.originalTitle,
        status: movies.status,
        originalLanguage: movies.originalLanguage,
        voteCount: movies.voteCount,
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
        tmdbId: movies.tmdbId,
      })
      .from(movies)
      .where(and(eq(movies.id, id), eq(movies.isPublished, true)))
      .limit(1),
    visibleVideos({ movieId: id }),
    db
      .selectDistinct({ audioLanguage: sources.audioLanguage })
      .from(sources)
      .where(and(eq(sources.movieId, id), eq(sources.isActive, true))),
  ]);
  const hasSources = langs.length > 0;
  if (movie?.tmdbId) cacheTag(tmdbTag("movie", movie.tmdbId));
  return movie ? { ...movie, videos: vids, playable: hasSources || Boolean(movie.tmdbId), isEvo: !hasSources && Boolean(movie.tmdbId), dubs: dubCodes(langs) } : null;
}

export type MovieDetail = NonNullable<Awaited<ReturnType<typeof getDbMovieDetail>>>;

/** Published movie with its visible videos; null when missing or unpublished. */
export const getMovieDetail = cache(async (id: string): Promise<MovieDetail | null> => {
  "use cache";
  catalogCache();

  const media = parseMediaId(id);
  if (!media) return null;

  if (media.kind === "tmdb") {
    cacheTag(tmdbTag("movie", media.tmdbId));
    const localId = await findMovieIdByTmdb(media.tmdbId);
    if (localId) {
      const localDetail = await getDbMovieDetail(localId);
      if (localDetail) return localDetail;
    }

    try {
      const tmdbMovie = await getMovieSummary(media.tmdbId);
      return {
        id: `tmdb-${media.tmdbId}`,
        title: tmdbMovie.title,
        originalTitle: tmdbMovie.originalTitle,
        status: tmdbMovie.status,
        originalLanguage: tmdbMovie.originalLanguage,
        voteCount: tmdbMovie.voteCount,
        tagline: tmdbMovie.tagline,
        overview: tmdbMovie.overview,
        releaseDate: tmdbMovie.releaseDate,
        runtimeMinutes: tmdbMovie.runtimeMinutes,
        genres: tmdbMovie.genres,
        rating: tmdbMovie.rating,
        posterPath: tmdbMovie.posterPath,
        backdropPath: tmdbMovie.backdropPath,
        logoPath: tmdbMovie.logoPath,
        galleryBackdrops: tmdbMovie.galleryBackdrops,
        cast: tmdbMovie.cast,
        tmdbId: tmdbMovie.tmdbId,
        videos: tmdbMovie.videos.map((v, i) => ({ id: `tmdb-vid-${i}`, ...v })),
        playable: true,
        isEvo: true,
        dubs: [],
      };
    } catch {
      return null;
    }
  }

  return getDbMovieDetail(media.id);
});

async function getDbShowBase(id: string) {
  "use cache";
  catalogCache();
  cacheTag(titleTag("show", id));
  const [[show], vids, seasonRows, langs] = await Promise.all([
    db
      .select({
        id: shows.id,
        title: shows.name,
        originalTitle: shows.originalName,
        originalLanguage: shows.originalLanguage,
        voteCount: shows.voteCount,
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
        tmdbId: shows.tmdbId,
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
        episodeCount: sql<number>`count(${episodes.id})::int`,
        upcomingCount: sql<number>`count(${episodes.id}) filter (where ${episodes.airDate} > (now() at time zone 'Asia/Colombo')::date)::int`,
        firstEpisode: sql<number | null>`min(${episodes.episodeNumber}) filter (where ${airedEpisode()})`,
      })
      .from(seasons)
      .leftJoin(episodes, and(eq(episodes.seasonId, seasons.id), eq(episodes.isVisible, true)))
      .where(and(eq(seasons.showId, id), eq(seasons.isVisible, true)))
      .groupBy(seasons.id)
      .orderBy(asc(seasons.seasonNumber)),
    db
      .selectDistinct({ audioLanguage: sources.audioLanguage })
      .from(sources)
      .innerJoin(episodes, eq(episodes.id, sources.episodeId))
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .where(and(eq(seasons.showId, id), eq(sources.isActive, true))),
  ]);
  if (!show) return null;
  if (show.tmdbId) cacheTag(tmdbTag("tv", show.tmdbId));
  const firstSeason = seasonRows.find((s) => s.seasonNumber > 0 && s.firstEpisode !== null)
    ?? seasonRows.find((s) => s.firstEpisode !== null);
  const first = firstSeason ? { seasonNumber: firstSeason.seasonNumber, episodeNumber: firstSeason.firstEpisode! } : null;

  return { ...show, videos: vids, seasons: seasonRows, first, dubs: dubCodes(langs) };
}

async function getDbShowDetail(id: string, seasonNumber: number | null, includeEpisodes: boolean) {
  const show = await getDbShowBase(id);
  if (!show) return null;
  const { seasons: seasonRows, first } = show;
  const selected: (typeof seasonRows)[number] | null =
    seasonRows.find((s) => s.seasonNumber === seasonNumber) ??
    seasonRows.find((s) => s.seasonNumber === first?.seasonNumber) ??
    (seasonRows.length > 0 ? seasonRows[0] : null);
  const eps = selected && includeEpisodes
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
  return { ...show, selected, episodes: eps };
}

export type ShowDetail = NonNullable<Awaited<ReturnType<typeof getDbShowDetail>>>;

/** Published show with visible seasons; episodes are for the selected season only. */
export const getShowDetail = cache(async (id: string, seasonNumber: number | null, includeEpisodes = true): Promise<ShowDetail | null> => {
  "use cache";
  catalogCache();

  const media = parseMediaId(id);
  if (!media) return null;

  if (media.kind === "tmdb") {
    const localId = await findShowIdByTmdb(media.tmdbId);
    if (localId) {
      const localDetail = await getDbShowDetail(localId, seasonNumber, includeEpisodes);
      if (localDetail) return localDetail;
    }

    try {
      cacheTag(tmdbTag("tv", media.tmdbId));
      const s = await getShowSummary(media.tmdbId);
      const selected =
        s.seasons.find((sec) => sec.seasonNumber === seasonNumber) ??
        s.seasons.find((sec) => sec.seasonNumber === 1) ??
        s.seasons[0] ??
        null;
      const selectedEpisodes = selected && includeEpisodes ? await getShowSeason(media.tmdbId, selected.seasonNumber).catch(() => []) : [];
      const eps = selectedEpisodes.map((e) => ({
        id: `tmdb-ep-${media.tmdbId}-${selected?.seasonNumber ?? 1}-${e.episodeNumber}`,
        episodeNumber: e.episodeNumber,
        name: e.name,
        overview: e.overview,
        airDate: e.airDate,
        runtimeMinutes: e.runtimeMinutes,
        stillPath: e.stillPath,
      }));
      const seasonRows = s.seasons.map((sec) => ({
        id: `tmdb-season-${media.tmdbId}-${sec.seasonNumber}`,
        seasonNumber: sec.seasonNumber,
        name: sec.name,
        overview: sec.overview,
        airDate: sec.airDate,
        posterPath: sec.posterPath,
        episodeCount: sec.episodeCount,
        // TMDB summaries expose the latest aired episode; only the selected season needs episode detail.
        upcomingCount: sec.seasonNumber === selected?.seasonNumber && includeEpisodes
          ? selectedEpisodes.filter((e) => isUpcoming(e.airDate)).length
          : isUpcoming(sec.airDate) ? sec.episodeCount
          : s.lastEpisode?.seasonNumber === sec.seasonNumber ? Math.max(0, sec.episodeCount - s.lastEpisode.episodeNumber) : 0,
        firstEpisode: sec.seasonNumber === selected?.seasonNumber && includeEpisodes
          ? selectedEpisodes.find((e) => !isUpcoming(e.airDate))?.episodeNumber ?? null
          : sec.episodeCount > 0 && !isUpcoming(sec.airDate) ? 1 : null,
      }));
      const firstSeason = seasonRows.find((sec) => sec.seasonNumber > 0 && sec.firstEpisode !== null)
        ?? seasonRows.find((sec) => sec.firstEpisode !== null);
      const first = firstSeason ? { seasonNumber: firstSeason.seasonNumber, episodeNumber: firstSeason.firstEpisode! } : null;
      return {
        id: `tmdb-${media.tmdbId}`,
        title: s.name,
        originalTitle: s.originalName,
        originalLanguage: s.originalLanguage,
        voteCount: s.voteCount,
        tagline: s.tagline,
        overview: s.overview,
        firstAirDate: s.firstAirDate,
        lastAirDate: s.lastAirDate,
        status: s.status,
        genres: s.genres,
        rating: s.rating,
        posterPath: s.posterPath,
        backdropPath: s.backdropPath,
        logoPath: s.logoPath,
        galleryBackdrops: s.galleryBackdrops,
        cast: s.cast,
        tmdbId: s.tmdbId,
        videos: s.videos.map((v, i) => ({ id: `tmdb-vid-${i}`, ...v })),
        seasons: seasonRows,
        selected: seasonRows.find((sec) => sec.seasonNumber === selected?.seasonNumber) ?? null,
        episodes: eps,
        first,
        dubs: [],
      };
    } catch {
      return null;
    }
  }

  return getDbShowDetail(media.id, seasonNumber, includeEpisodes);
});

/** Hero metadata never waits for a season endpoint or the season episode query. */
export const getShowHero = (id: string) => getShowDetail(id, null, false);
