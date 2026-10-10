// Server-only TMDB client. The API key never leaves the server.
import { env } from "@/lib/env";
import type { CastMember } from "@/db/schema";
import { isValidKey, type VideoPrefill, type VideoSite, type VideoType } from "@/lib/videos";

const BASE = "https://api.themoviedb.org/3";
const SEASON_CONCURRENCY = 4;
const CAST_LIMIT = 15;

export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function imageUrl(path: string | null | undefined, size = "w500") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

async function tmdb<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("api_key", env.TMDB_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch {
    throw new TmdbError("Could not reach TMDB", 502);
  }
  if (res.status === 404) throw new TmdbError("Not found on TMDB", 404);
  if (res.status === 401) throw new TmdbError("TMDB rejected the API key", 502);
  if (res.status === 429) throw new TmdbError("TMDB rate limit reached, try again shortly", 503);
  if (!res.ok) throw new TmdbError(`TMDB error (${res.status})`, 502);
  return (await res.json()) as T;
}

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
const numOrNull = (v: unknown) => (typeof v === "number" ? v : null);
const rating = (v: unknown) => (typeof v === "number" && v > 0 ? Math.round(v * 10) / 10 : null);
const genres = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((g: Raw) => str(g?.name)).filter(Boolean) : [];

function cast(credits: Raw | undefined): CastMember[] {
  const list: Raw[] = Array.isArray(credits?.cast) ? credits.cast : [];
  return list.slice(0, CAST_LIMIT).map((c) => ({
    name: str(c.name),
    character: str(c.character),
    profilePath: strOrNull(c.profile_path),
  }));
}

const TMDB_TYPES: Record<string, VideoType> = {
  trailer: "trailer",
  teaser: "teaser",
  clip: "clip",
  featurette: "featurette",
  "behind the scenes": "behind_the_scenes",
  bloopers: "bloopers",
  "opening credits": "opening_credits",
};
const TMDB_SITES: Record<string, VideoSite> = { youtube: "youtube", vimeo: "vimeo" };
const VIDEO_LIMIT = 50;

/** Maps TMDB's `videos` block: YouTube/Vimeo only, deduped, trailers/official/newest first. */
function mapVideos(block: Raw | undefined): VideoPrefill[] {
  const list: Raw[] = Array.isArray(block?.results) ? block.results : [];
  const seen = new Set<string>();
  const items: Omit<VideoPrefill, "sortOrder">[] = [];
  for (const v of list) {
    const site = TMDB_SITES[str(v.site).toLowerCase()];
    const key = str(v.key).trim();
    if (!site || !isValidKey(site, key) || seen.has(`${site}:${key}`)) continue;
    seen.add(`${site}:${key}`);
    const published = typeof v.published_at === "string" && !Number.isNaN(Date.parse(v.published_at));
    items.push({
      site,
      key,
      name: str(v.name).trim().slice(0, 300) || key,
      type: TMDB_TYPES[str(v.type).toLowerCase()] ?? "other",
      official: v.official === true,
      language: /^[a-z]{2}$/i.test(str(v.iso_639_1)) ? str(v.iso_639_1).toLowerCase() : null,
      publishedAt: published ? new Date(v.published_at).toISOString() : null,
    });
  }
  const time = (x: { publishedAt: string | null }) => (x.publishedAt ? Date.parse(x.publishedAt) : 0);
  items.sort(
    (a, b) =>
      Number(b.type === "trailer") - Number(a.type === "trailer") ||
      Number(b.official) - Number(a.official) ||
      time(b) - time(a),
  );
  return items.slice(0, VIDEO_LIMIT).map((v, i) => ({ ...v, sortOrder: i }));
}

// `include_video_language` makes English (and untagged) videos come back even
// when the title's own language differs from the request language.
const DETAIL_PARAMS = { append_to_response: "credits,videos", include_video_language: "en,null" };

/** Videos for an already-stored title (used by the import endpoint). */
export async function getTmdbVideos(kind: "movie" | "tv", tmdbId: number): Promise<VideoPrefill[]> {
  const data = await tmdb<Raw>(`/${kind}/${tmdbId}/videos`, { include_video_language: "en,null" });
  return mapVideos(data);
}

const year = (d: unknown) => (typeof d === "string" && d.length >= 4 ? Number(d.slice(0, 4)) || null : null);

export type SearchResult = {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  overview: string;
};
export type SearchPage = { page: number; totalPages: number; results: SearchResult[] };

async function search(kind: "movie" | "tv", query: string, page: number): Promise<SearchPage> {
  const data = await tmdb<Raw>(`/search/${kind}`, { query, page, include_adult: "false" });
  const results: SearchResult[] = (data.results ?? []).map((r: Raw) => ({
    tmdbId: r.id,
    title: str(kind === "movie" ? r.title : r.name),
    year: year(kind === "movie" ? r.release_date : r.first_air_date),
    posterPath: strOrNull(r.poster_path),
    overview: str(r.overview).slice(0, 200),
  }));
  return { page: data.page ?? page, totalPages: data.total_pages ?? 1, results };
}

export const searchMovies = (query: string, page = 1) => search("movie", query, page);
export const searchShows = (query: string, page = 1) => search("tv", query, page);

export type MoviePrefill = {
  tmdbId: number;
  title: string;
  originalTitle: string;
  tagline: string;
  overview: string;
  releaseDate: string | null;
  runtimeMinutes: number | null;
  genres: string[];
  rating: number | null;
  voteCount: number | null;
  originalLanguage: string;
  status: string;
  posterPath: string | null;
  backdropPath: string | null;
  cast: CastMember[];
  videos: VideoPrefill[];
};

export async function getMovieDetails(tmdbId: number): Promise<MoviePrefill> {
  const m = await tmdb<Raw>(`/movie/${tmdbId}`, DETAIL_PARAMS);
  return {
    tmdbId: m.id,
    title: str(m.title),
    originalTitle: str(m.original_title),
    tagline: str(m.tagline),
    overview: str(m.overview),
    releaseDate: strOrNull(m.release_date),
    runtimeMinutes: m.runtime ? numOrNull(m.runtime) : null,
    genres: genres(m.genres),
    rating: rating(m.vote_average),
    voteCount: numOrNull(m.vote_count),
    originalLanguage: str(m.original_language),
    status: str(m.status),
    posterPath: strOrNull(m.poster_path),
    backdropPath: strOrNull(m.backdrop_path),
    cast: cast(m.credits),
    videos: mapVideos(m.videos),
  };
}

export type EpisodePrefill = {
  tmdbId: number | null;
  episodeNumber: number;
  name: string;
  overview: string;
  airDate: string | null;
  runtimeMinutes: number | null;
  stillPath: string | null;
  isVisible: boolean;
};
export type SeasonPrefill = {
  tmdbId: number | null;
  seasonNumber: number;
  name: string;
  overview: string;
  airDate: string | null;
  posterPath: string | null;
  isVisible: boolean;
  episodes: EpisodePrefill[];
};
export type ShowPrefill = {
  tmdbId: number;
  name: string;
  originalName: string;
  tagline: string;
  overview: string;
  firstAirDate: string | null;
  lastAirDate: string | null;
  status: string;
  genres: string[];
  rating: number | null;
  voteCount: number | null;
  originalLanguage: string;
  posterPath: string | null;
  backdropPath: string | null;
  cast: CastMember[];
  videos: VideoPrefill[];
  seasons: SeasonPrefill[];
  /** Season numbers whose episodes could not be loaded from TMDB. */
  warnings: string[];
};

function mapEpisode(e: Raw): EpisodePrefill {
  return {
    tmdbId: numOrNull(e.id),
    episodeNumber: e.episode_number,
    name: str(e.name),
    overview: str(e.overview),
    airDate: strOrNull(e.air_date),
    runtimeMinutes: e.runtime ? numOrNull(e.runtime) : null,
    stillPath: strOrNull(e.still_path),
    isVisible: true,
  };
}

export async function getShowDetails(tmdbId: number): Promise<ShowPrefill> {
  const s = await tmdb<Raw>(`/tv/${tmdbId}`, DETAIL_PARAMS);
  const rawSeasons: Raw[] = Array.isArray(s.seasons) ? s.seasons : [];
  const warnings: string[] = [];
  const seasons: SeasonPrefill[] = rawSeasons.map((r) => ({
    tmdbId: numOrNull(r.id),
    seasonNumber: r.season_number,
    name: str(r.name),
    overview: str(r.overview),
    airDate: strOrNull(r.air_date),
    posterPath: strOrNull(r.poster_path),
    isVisible: true,
    episodes: [],
  }));

  // Small worker pool: each worker pulls the next season until none are left.
  let next = 0;
  const worker = async () => {
    while (next < seasons.length) {
      const season = seasons[next++];
      try {
        const data = await tmdb<Raw>(`/tv/${tmdbId}/season/${season.seasonNumber}`);
        season.episodes = (data.episodes ?? []).map(mapEpisode);
      } catch {
        warnings.push(`Episodes for season ${season.seasonNumber} could not be loaded`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEASON_CONCURRENCY, seasons.length) }, worker));

  return {
    tmdbId: s.id,
    name: str(s.name),
    originalName: str(s.original_name),
    tagline: str(s.tagline),
    overview: str(s.overview),
    firstAirDate: strOrNull(s.first_air_date),
    lastAirDate: strOrNull(s.last_air_date),
    status: str(s.status),
    genres: genres(s.genres),
    rating: rating(s.vote_average),
    voteCount: numOrNull(s.vote_count),
    originalLanguage: str(s.original_language),
    posterPath: strOrNull(s.poster_path),
    backdropPath: strOrNull(s.backdrop_path),
    cast: cast(s.credits),
    videos: mapVideos(s.videos),
    seasons,
    warnings: warnings.sort(),
  };
}
