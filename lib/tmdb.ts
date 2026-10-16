// Server-only TMDB client. The API key never leaves the server.
import { env } from "@/lib/env";
import type { CastMember } from "@/db/schema";
import { pickImages } from "@/lib/cms/image-pick";
import {
  EMPTY_CANDIDATES,
  imageUrl,
  isImagePath,
  type ImageCandidate,
  type ImageCandidates,
  type ImageSelection,
} from "@/lib/images";
import { compareVideos, isValidKey, type VideoPrefill, type VideoSite, type VideoType } from "@/lib/videos";

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

export { imageUrl };

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
  items.sort(compareVideos);
  return items.slice(0, VIDEO_LIMIT).map((v, i) => ({ ...v, sortOrder: i }));
}

// `include_video_language` makes English (and untagged) videos come back even
// when the title's own language differs from the request language.
const DETAIL_PARAMS = {
  append_to_response: "credits,videos,images",
  include_video_language: "en,null",
  include_image_language: "en,null",
};

function mapImageList(list: unknown): ImageCandidate[] {
  if (!Array.isArray(list)) return [];
  const out: ImageCandidate[] = [];
  for (const i of list as Raw[]) {
    if (!isImagePath(i?.file_path)) continue;
    out.push({
      filePath: i.file_path,
      width: typeof i.width === "number" ? i.width : 0,
      height: typeof i.height === "number" ? i.height : 0,
      language: /^[a-z]{2}$/i.test(str(i.iso_639_1)) ? str(i.iso_639_1).toLowerCase() : null,
      voteAverage: typeof i.vote_average === "number" ? Math.round(i.vote_average * 1000) / 1000 : 0,
    });
  }
  return out;
}

/** Maps a TMDB `images` block (all three kinds). */
function mapImages(block: Raw | undefined): ImageCandidates {
  if (!block) return EMPTY_CANDIDATES;
  return {
    posters: mapImageList(block.posters),
    backdrops: mapImageList(block.backdrops),
    logos: mapImageList(block.logos),
  };
}

/** All images of a stored/known title plus the auto-picked selection. */
export async function getTmdbImages(
  kind: "movie" | "tv",
  tmdbId: number,
): Promise<{ candidates: ImageCandidates; selection: ImageSelection }> {
  const data = await tmdb<Raw>(`/${kind}/${tmdbId}/images`, { include_image_language: "en,null" });
  const candidates = mapImages(data);
  return { candidates, selection: pickImages(candidates) };
}

/** The title-treatment image TMDB considers best (English or textless), for overlay on cards. */
export async function getTmdbLogo(kind: "movie" | "tv", tmdbId: number): Promise<string | null> {
  return (await getTmdbImages(kind, tmdbId)).selection.logoPath;
}

/** Poster candidates of one season. */
export async function getTmdbSeasonImages(tmdbId: number, seasonNumber: number): Promise<ImageCandidate[]> {
  const data = await tmdb<Raw>(`/tv/${tmdbId}/season/${seasonNumber}/images`, {
    include_image_language: "en,null",
  });
  return mapImageList(data.posters);
}

/** Auto-picked images win; TMDB's own default poster/backdrop is the fallback. */
function withPicked(images: ImageCandidates, defaults: { poster: string | null; backdrop: string | null }) {
  const sel = pickImages(images);
  return {
    images,
    posterPath: sel.posterPath ?? defaults.poster,
    backdropPath: sel.backdropPath ?? defaults.backdrop,
    logoPath: sel.logoPath,
    galleryBackdrops: sel.galleryBackdrops,
  };
}

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

/** IMDb id ("tt0123456") for a TMDB title, or null when TMDB has none. The engine needs it to find subtitles. */
export async function getImdbId(kind: "movie" | "tv", tmdbId: number): Promise<string | null> {
  const ids = await tmdb<Raw>(`/${kind}/${tmdbId}/external_ids`);
  return typeof ids.imdb_id === "string" && /^tt\d+$/.test(ids.imdb_id) ? ids.imdb_id : null;
}

/** US age rating (G, PG, TV-Y7, ...) from the appended release_dates / content_ratings block. */
function certification(kind: "movie" | "tv", block: Raw | undefined): string | null {
  const us = (Array.isArray(block?.results) ? (block.results as Raw[]) : []).find((r) => r.iso_3166_1 === "US");
  if (!us) return null;
  const value = kind === "movie" ? (us.release_dates as Raw[] | undefined)?.map((d) => str(d.certification)).find(Boolean) : str(us.rating);
  return value || null;
}

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
  /** US age rating, e.g. "PG". */
  certification: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  logoPath: string | null;
  galleryBackdrops: string[];
  /** Every TMDB image candidate, for the gallery picker. */
  images: ImageCandidates;
  cast: CastMember[];
  videos: VideoPrefill[];
};

export async function getMovieDetails(tmdbId: number): Promise<MoviePrefill> {
  const m = await tmdb<Raw>(`/movie/${tmdbId}`, { ...DETAIL_PARAMS, append_to_response: `${DETAIL_PARAMS.append_to_response},release_dates` });
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
    certification: certification("movie", m.release_dates),
    ...withPicked(mapImages(m.images), { poster: strOrNull(m.poster_path), backdrop: strOrNull(m.backdrop_path) }),
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
  /** US age rating, e.g. "TV-Y7". */
  certification: string | null;
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
  logoPath: string | null;
  galleryBackdrops: string[];
  /** Every TMDB image candidate, for the gallery picker. */
  images: ImageCandidates;
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
  const s = await tmdb<Raw>(`/tv/${tmdbId}`, { ...DETAIL_PARAMS, append_to_response: `${DETAIL_PARAMS.append_to_response},content_ratings` });
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
    certification: certification("tv", s.content_ratings),
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
    ...withPicked(mapImages(s.images), { poster: strOrNull(s.poster_path), backdrop: strOrNull(s.backdrop_path) }),
    cast: cast(s.credits),
    videos: mapVideos(s.videos),
    seasons,
    warnings: warnings.sort(),
  };
}

export type TmdbCatalogItem = {
  tmdbId: number;
  title: string;
  date: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
  overview: string;
};

export type TmdbCatalogPage = {
  page: number;
  totalPages: number;
  totalResults: number;
  items: TmdbCatalogItem[];
};

export async function getPopularMedia(kind: "movie" | "tv", page = 1): Promise<TmdbCatalogPage> {
  const data = await tmdb<Raw>(`/${kind}/popular`, { page });
  const items: TmdbCatalogItem[] = (data.results ?? []).map((r: Raw) => ({
    tmdbId: r.id,
    title: str(kind === "movie" ? r.title : r.name),
    date: strOrNull(kind === "movie" ? r.release_date : r.first_air_date),
    posterPath: strOrNull(r.poster_path),
    backdropPath: strOrNull(r.backdrop_path),
    rating: rating(r.vote_average),
    overview: str(r.overview),
  }));
  return { page: data.page ?? page, totalPages: Math.min(data.total_pages ?? 1, 500), totalResults: data.total_results ?? items.length, items };
}

export async function getTrendingMedia(kind: "movie" | "tv", timeWindow: "day" | "week" = "week", page = 1): Promise<TmdbCatalogPage> {
  const data = await tmdb<Raw>(`/trending/${kind}/${timeWindow}`, { page });
  const items: TmdbCatalogItem[] = (data.results ?? []).map((r: Raw) => ({
    tmdbId: r.id,
    title: str(kind === "movie" ? r.title : r.name),
    date: strOrNull(kind === "movie" ? r.release_date : r.first_air_date),
    posterPath: strOrNull(r.poster_path),
    backdropPath: strOrNull(r.backdrop_path),
    rating: rating(r.vote_average),
    overview: str(r.overview),
  }));
  return { page: data.page ?? page, totalPages: Math.min(data.total_pages ?? 1, 500), totalResults: data.total_results ?? items.length, items };
}

const mapCatalogPage = (kind: "movie" | "tv", data: Raw, page: number): TmdbCatalogPage => {
  const items: TmdbCatalogItem[] = (data.results ?? []).map((r: Raw) => ({
    tmdbId: r.id,
    title: str(kind === "movie" ? r.title : r.name),
    date: strOrNull(kind === "movie" ? r.release_date : r.first_air_date),
    posterPath: strOrNull(r.poster_path),
    backdropPath: strOrNull(r.backdrop_path),
    rating: rating(r.vote_average),
    overview: str(r.overview),
  }));
  return { page: data.page ?? page, totalPages: Math.min(data.total_pages ?? 1, 500), totalResults: data.total_results ?? items.length, items };
};

// Not for children even when tagged Family/Animation/Kids: crime, mystery, reality, soap, talk, war & politics.
const KIDS_EXCLUDED_GENRES = "80,9648,10764,10766,10767,10768";

export type KidsSort = "popular" | "newest" | "title";

/**
 * Kids catalog from TMDB. Movies: US certification G/PG plus Family or Animation. Shows: TMDB has no certification
 * filter for TV, and its Family/Animation tags also cover adult sitcoms, so shows must carry TMDB's own "Kids" genre.
 * `genre` narrows within that (movies: any G/PG title of the genre; shows: Kids shows of the genre).
 */
export async function getKidsMedia(kind: "movie" | "tv", params: { genre?: number; sort?: KidsSort; page?: number } = {}): Promise<TmdbCatalogPage> {
  const today = new Date().toISOString().slice(0, 10);
  const sort = params.sort ?? "popular";
  const q: Record<string, string | number> = { page: params.page ?? 1, include_adult: "false", "vote_count.gte": 15 };
  if (kind === "movie") {
    q.certification_country = "US";
    q["certification.lte"] = "PG";
    q.with_genres = params.genre ? String(params.genre) : "10751|16";
    q["primary_release_date.lte"] = today;
    q.sort_by = sort === "newest" ? "primary_release_date.desc" : sort === "title" ? "original_title.asc" : "popularity.desc";
  } else {
    q.with_genres = params.genre ? `10762,${params.genre}` : "10762";
    q.without_genres = KIDS_EXCLUDED_GENRES;
    q["first_air_date.lte"] = today;
    q.sort_by = sort === "newest" ? "first_air_date.desc" : sort === "title" ? "name.asc" : "popularity.desc";
  }
  return mapCatalogPage(kind, await tmdb<Raw>(`/discover/${kind}`, q), params.page ?? 1);
}

/** Search restricted to kid-friendly genres (TMDB's search cannot filter by certification, so movies are judged by genre). */
export async function searchKidsMedia(kind: "movie" | "tv", query: string, page = 1): Promise<TmdbCatalogPage> {
  const data = await tmdb<Raw>(`/search/${kind}`, { query, page, include_adult: "false" });
  const wanted = kind === "movie" ? [10751, 16] : [10762];
  const kept = (data.results ?? []).filter((r: Raw) => Array.isArray(r.genre_ids) && r.genre_ids.some((g: number) => wanted.includes(g)) && !r.genre_ids.some((g: number) => [80, 9648, 10764, 10766, 10767, 10768].includes(g)));
  return mapCatalogPage(kind, { ...data, results: kept }, page);
}

export async function getDiscoverMedia(kind: "movie" | "tv", params: { withGenres?: string; sortBy?: string; page?: number } = {}): Promise<TmdbCatalogPage> {
  const tmdbParams: Record<string, string | number> = {
    page: params.page ?? 1,
    include_adult: "false",
    "vote_count.gte": 10,
  };
  if (params.withGenres) tmdbParams.with_genres = params.withGenres;
  if (params.sortBy) tmdbParams.sort_by = params.sortBy;
  const data = await tmdb<Raw>(`/discover/${kind}`, tmdbParams);
  const items: TmdbCatalogItem[] = (data.results ?? []).map((r: Raw) => ({
    tmdbId: r.id,
    title: str(kind === "movie" ? r.title : r.name),
    date: strOrNull(kind === "movie" ? r.release_date : r.first_air_date),
    posterPath: strOrNull(r.poster_path),
    backdropPath: strOrNull(r.backdrop_path),
    rating: rating(r.vote_average),
    overview: str(r.overview),
  }));
  return { page: data.page ?? (params.page ?? 1), totalPages: Math.min(data.total_pages ?? 1, 500), totalResults: data.total_results ?? items.length, items };
}

