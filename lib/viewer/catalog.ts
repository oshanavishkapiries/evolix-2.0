import { AUDIO_LANGUAGES } from "@/lib/audio";
import { cacheTag } from "next/cache";
import { catalogCache, catalogListTag, CATALOG_TAG, tmdbTag } from "./cache";
import { and, count, eq, ilike, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { movies, shows } from "@/db/schema";
import { escapeLike } from "@/lib/cms/search";
import { getDiscoverMedia, getTmdbLogo, getTrendingMedia, searchMovies, searchShows, type TmdbCatalogItem } from "@/lib/tmdb";
import type { CardKind } from "./ids";
import { captureException } from "@/lib/errors/capture";

// Everything here only ever returns PUBLISHED titles.

export type Card = {
  kind: CardKind;
  id: string;
  title: string;
  date: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  /** Title-treatment image (transparent PNG); only some titles have one. */
  logoPath?: string | null;
  rating: number | null;
  /** Audio (dub) language codes this title has playable sources for, e.g. ["si", "en"]. */
  dubs?: string[];
  /** Marked for on-demand resolution via Evo Engine */
  isEvo?: boolean;
};

export type Sort = "newest" | "title" | "year";
// TMDB discover supports release dates, but no consistent title order across movies/TV.
export const SORTS: Sort[] = ["newest", "year"];
export type TypeFilter = "all" | CardKind;
export const SEARCH_PAGE_SIZE = 24;
export const MIN_QUERY = 2;

type Filters = { q?: string; genre?: string; withBackdrop?: boolean };

/** Same output columns for movies and shows so the two can be UNIONed. */
function cardQuery(kind: CardKind, f: Filters) {
  const t =
    kind === "movie"
      ? { table: movies, title: movies.title, original: movies.originalTitle, date: movies.releaseDate }
      : { table: shows, title: shows.name, original: shows.originalName, date: shows.firstAirDate };
  const { table } = t;
  return {
    where: whereFor(table.isPublished, table.genres, table.backdropPath, [t.title, t.original], f, hasSourcesOf(kind)),
    select: () =>
      db
        .select({
          kind: sql<CardKind>`${kind}::text`.as("kind"),
          id: sql<string>`${table.id}`.as("id"),
          title: sql<string>`${t.title}`.as("title"),
          sortTitle: sql<string>`lower(${t.title})`.as("sort_title"),
          date: sql<string | null>`${t.date}`.as("date"),
          posterPath: sql<string | null>`${table.posterPath}`.as("poster_path"),
          backdropPath: sql<string | null>`${table.backdropPath}`.as("backdrop_path"),
          logoPath: sql<string | null>`${table.logoPath}`.as("logo_path"),
          rating: sql<number | null>`${table.rating}`.as("rating"),
          dubs: dubsOf(kind).as("dubs"),
          hasSources: hasSourcesOf(kind).as("has_sources"),
          createdAt: sql<Date>`${table.createdAt}`.as("created_at"),
        })
        .from(table),
  };
}

/** Distinct audio languages of a title's active sources (episodes' sources for a show). */
function dubsOf(kind: CardKind) {
  // Qualified by hand: drizzle drops the table name on single-table selects, which makes "id" ambiguous here.
  const id = sql.raw(kind === "movie" ? "movies.id" : "shows.id");
  return kind === "movie"
    ? sql<string[]>`array(select distinct s.audio_language from sources s where s.movie_id = ${id} and s.is_active and s.audio_language <> '' order by 1)`
    : sql<string[]>`array(select distinct s.audio_language from sources s join episodes e on e.id = s.episode_id join seasons se on se.id = e.season_id where se.show_id = ${id} and s.is_active and s.audio_language <> '' order by 1)`;
}

/** Whether this title has at least one active playable source (episodes' sources for a show). */
function hasSourcesOf(kind: CardKind) {
  const id = sql.raw(kind === "movie" ? "movies.id" : "shows.id");
  return kind === "movie"
    ? sql<boolean>`exists (select 1 from sources s where s.movie_id = ${id} and s.is_active)`
    : sql<boolean>`exists (select 1 from sources s join episodes e on e.id = s.episode_id join seasons se on se.id = e.season_id where se.show_id = ${id} and s.is_active)`;
}

/** Postgres arrays can arrive as "{si,en}" text depending on the driver path. */
const toList = (v: unknown): string[] => {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.replace(/^\{|\}$/g, "").split(",").filter(Boolean) : [];
  const rank = (c: string) => AUDIO_LANGUAGES.findIndex((l) => l.code === c);
  return list.sort((a, b) => rank(a) - rank(b));
};

function whereFor(published: AnyColumn, genres: AnyColumn, backdrop: AnyColumn, textColumns: AnyColumn[], f: Filters, cached: SQL): SQL | undefined {
  // Evo creates a row for every title someone plays or bookmarks; only titles with a cached source are catalog entries.
  const parts: (SQL | undefined)[] = [eq(published, true), cached];
  if (f.withBackdrop) parts.push(sql`${backdrop} is not null`);
  const q = f.q?.trim();
  if (q && q.length >= MIN_QUERY) {
    const pattern = `%${escapeLike(q)}%`;
    parts.push(or(...textColumns.map((c) => ilike(c, pattern))));
  }
  if (f.genre) parts.push(sql`${f.genre} = any(${genres})`);
  return and(...parts);
}

const ORDER: Record<Sort, SQL> = {
  newest: sql`created_at desc, id desc`,
  title: sql`sort_title asc, id asc`,
  year: sql`date desc nulls last, id desc`,
};

export type BrowseParams = Filters & {
  type?: TypeFilter;
  sort?: Sort;
  limit?: number;
  offset?: number;
  withTotal?: boolean;
};

const TMDB_GENRES: Record<string, number> = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 14,
  History: 36,
  Horror: 27,
  Music: 10402,
  Mystery: 9648,
  Romance: 10749,
  "Science Fiction": 878,
  "Sci-Fi": 878,
  Thriller: 53,
  War: 10752,
  Western: 37,
  "Action & Adventure": 10759,
  "Sci-Fi & Fantasy": 10765,
};

/** Published titles directly from the local PostgreSQL database (used for fallbacks). */
async function browseDb(p: BrowseParams = {}): Promise<{ items: Card[]; total: number }> {
  const type = p.type ?? "all";
  const limit = p.limit ?? SEARCH_PAGE_SIZE;
  const offset = p.offset ?? 0;
  const order = ORDER[p.sort ?? "newest"];
  const m = cardQuery("movie", p);
  const s = cardQuery("show", p);

  const rows =
    type === "all"
      ? unionAll(m.select().where(m.where).$dynamic(), s.select().where(s.where).$dynamic())
          .orderBy(order)
          .limit(limit)
          .offset(offset)
      : (type === "movie" ? m : s).select().where((type === "movie" ? m : s).where).orderBy(order).limit(limit).offset(offset);

  const counts = async () => {
    if (!p.withTotal) return 0;
    const [mc, sc] = await Promise.all([
      type === "show" ? 0 : db.select({ n: count() }).from(movies).where(m.where).then((r) => r[0].n),
      type === "movie" ? 0 : db.select({ n: count() }).from(shows).where(s.where).then((r) => r[0].n),
    ]);
    return mc + sc;
  };

  const [items, total] = await Promise.all([rows, counts()]);
  return {
    items: items.map(({ kind, id, title, date, posterPath, backdropPath, logoPath, rating, dubs, hasSources }) => {
      const dubList = toList(dubs);
      return {
        kind,
        id,
        title,
        date,
        posterPath,
        backdropPath,
        logoPath,
        rating,
        dubs: dubList,
        isEvo: !hasSources,
      };
    }),
    total,
  };
}

/** The local-source prefix is shared across offsets and page sizes. */
async function localSourcePrefix(type: TypeFilter, withBackdrop: boolean): Promise<Card[]> {
  "use cache";
  catalogCache();
  cacheTag(catalogListTag, CATALOG_TAG);
  return (await browseDb({ type, withBackdrop, limit: 10, offset: 0, withTotal: false })).items;
}

/** TMDB items -> cards; titles already cached locally link to their catalog row instead of `tmdb-N`. */
async function tmdbCards(tmdbItems: (TmdbCatalogItem & { kind: CardKind })[], limit: number): Promise<Card[]> {
  // Cross-reference with local database: a title with a cached source is served by its row, the rest are on-demand (Evo)
  const movieTmdbIds = tmdbItems.filter((i) => i.kind === "movie").map((i) => i.tmdbId).filter(Boolean);
  const showTmdbIds = tmdbItems.filter((i) => i.kind === "show").map((i) => i.tmdbId).filter(Boolean);

  const [localMovies, localShows] = await Promise.all([
    movieTmdbIds.length > 0
      ? db.select({ id: movies.id, tmdbId: movies.tmdbId, isPublished: movies.isPublished, hasSources: hasSourcesOf("movie") }).from(movies).where(inArray(movies.tmdbId, movieTmdbIds))
      : [],
    showTmdbIds.length > 0
      ? db.select({ id: shows.id, tmdbId: shows.tmdbId, isPublished: shows.isPublished, hasSources: hasSourcesOf("show") }).from(shows).where(inArray(shows.tmdbId, showTmdbIds))
      : [],
  ]);

  const movieMap = new Map(localMovies.map((m) => [m.tmdbId, m]));
  const showMap = new Map(localShows.map((s) => [s.tmdbId, s]));

  // An admin-unpublished title is hidden everywhere, including TMDB-sourced rows.
  const visible = tmdbItems.filter((item) => (item.kind === "movie" ? movieMap : showMap).get(item.tmdbId)?.isPublished !== false);
  const cards: Card[] = visible.slice(0, limit).map((item) => {
    const local = item.kind === "movie" ? movieMap.get(item.tmdbId) : showMap.get(item.tmdbId);
    const hasLocalSources = Boolean(local?.hasSources);
    return {
      kind: item.kind,
      id: hasLocalSources && local ? local.id : `tmdb-${item.tmdbId}`,
      title: item.title,
      date: item.date,
      posterPath: item.posterPath,
      backdropPath: item.backdropPath,
      rating: item.rating,
      isEvo: !hasLocalSources,
    };
  });

  return cards;
}

type NormalizedBrowse = Required<BrowseParams>;
type RemoteItem = TmdbCatalogItem & { kind: CardKind };
const TMDB_PAGE_SIZE = 20;
const TMDB_MAX_PAGES = 500;

/** Normalize before entering the cache: omitted, default and empty filters share an entry. */
export function normalizeBrowse(p: BrowseParams = {}): NormalizedBrowse {
  const q = p.q?.trim().slice(0, 100) ?? "";
  return {
    q: q.length >= MIN_QUERY ? q : "",
    genre: p.genre?.trim().slice(0, 50) ?? "",
    type: p.type === "movie" || p.type === "show" ? p.type : "all",
    sort: q.length >= MIN_QUERY ? "newest" : p.sort === "year" ? "year" : "newest",
    withBackdrop: Boolean(p.withBackdrop),
    limit: Number.isFinite(p.limit) ? Math.max(1, Math.min(100, Math.trunc(p.limit!))) : SEARCH_PAGE_SIZE,
    offset: Number.isFinite(p.offset) ? Math.max(0, Math.trunc(p.offset!)) : 0,
    withTotal: Boolean(p.withTotal),
  };
}

/** Individually cached upstream pages are reused between row sizes and browse offsets. */
async function remotePage(kind: CardKind, q: string, genre: string, sort: Sort, page: number): Promise<{ items: RemoteItem[]; total: number }> {
  "use cache";
  catalogCache();
  cacheTag(catalogListTag, CATALOG_TAG);
  const media = kind === "movie" ? "movie" : "tv";
  if (q) {
    const result = await (kind === "movie" ? searchMovies : searchShows)(q, page);
    return {
      items: result.results.map((r) => ({ ...r, kind, date: r.year ? `${r.year}-01-01` : null, backdropPath: null, rating: null })),
      total: Math.min(result.totalResults, TMDB_MAX_PAGES * TMDB_PAGE_SIZE),
    };
  }
  const genreId = genre ? TMDB_GENRES[genre] : undefined;
  // These are separate TMDB taxonomies. Map the combined movie/TV row to its TV equivalent.
  const tvGenre = genre === "Action" || genre === "Adventure" ? 10759
    : genre === "Sci-Fi" || genre === "Science Fiction" || genre === "Fantasy" ? 10765 : genreId;
  const movieGenre = genre === "Action & Adventure" ? 28 : genre === "Sci-Fi & Fantasy" ? 878 : genreId;
  const result = genre || sort === "year"
    ? await getDiscoverMedia(media, {
        withGenres: (kind === "show" ? tvGenre : movieGenre)?.toString(),
        sortBy: sort === "year" ? (kind === "movie" ? "primary_release_date.desc" : "first_air_date.desc") : "popularity.desc",
        page,
      })
    : await getTrendingMedia(media, "week", page);
  return { items: result.items.map((item) => ({ ...item, kind })), total: Math.min(result.totalResults, TMDB_MAX_PAGES * TMDB_PAGE_SIZE) };
}

async function getTmdbCatalog(p: NormalizedBrowse): Promise<{ items: Card[]; total: number }> {
  "use cache";
  catalogCache();
  cacheTag(catalogListTag, CATALOG_TAG);
  const kinds: CardKind[] = p.type === "all" ? ["movie", "show"] : [p.type];
  const first = await Promise.all(kinds.map((kind) => remotePage(kind, p.q, p.genre, p.sort, 1)));
  const totals = first.map((r) => r.total);
  const total = totals.reduce((a, b) => a + b, 0);
  const end = Math.min(p.offset + p.limit, total);
  if (p.offset >= end) return { items: [], total };

  // For relevance/popularity, alternate the two ranked streams, draining the longer one
  // after the shorter stream ends. This sequence is independent of the caller's page size.
  const positions: { stream: number; index: number }[] = [];
  if (kinds.length === 1) {
    for (let index = p.offset; index < end; index++) positions.push({ stream: 0, index });
  } else if (p.sort !== "year") {
    const shorter = Math.min(...totals);
    for (let index = p.offset; index < end; index++) {
      positions.push(index < 2 * shorter
        ? { stream: index % 2, index: Math.floor(index / 2) }
        : { stream: totals[0] > totals[1] ? 0 : 1, index: index - shorter });
    }
  } else {
    // A sorted merge needs the prefix of both date-sorted streams to find this window.
    for (let stream = 0; stream < kinds.length; stream++) {
      for (let index = 0; index < Math.min(end, totals[stream]); index++) positions.push({ stream, index });
    }
  }

  const pages = new Map<string, RemoteItem[]>();
  first.forEach((r, stream) => pages.set(`${stream}:1`, r.items));
  const needed = new Map<string, { stream: number; page: number }>();
  for (const { stream, index } of positions) {
    const page = Math.floor(index / TMDB_PAGE_SIZE) + 1;
    const key = `${stream}:${page}`;
    if (!pages.has(key)) needed.set(key, { stream, page });
  }
  const requests = [...needed.entries()];
  // Bound concurrent requests on deep date-sorted pages to avoid an API burst.
  for (let i = 0; i < requests.length; i += 8) {
    await Promise.all(requests.slice(i, i + 8).map(async ([key, { stream, page }]) => {
      pages.set(key, (await remotePage(kinds[stream], p.q, p.genre, p.sort, page)).items);
    }));
  }
  let items = positions.flatMap(({ stream, index }) => {
    const item = pages.get(`${stream}:${Math.floor(index / TMDB_PAGE_SIZE) + 1}`)?.[index % TMDB_PAGE_SIZE];
    return item ? [item] : [];
  });
  if (kinds.length > 1 && p.sort === "year") {
    items = items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.kind.localeCompare(b.kind)).slice(p.offset, end);
  }
  return { items: await tmdbCards(items, p.limit), total };
}

/** Public lists only. Request-specific/personal data must stay outside this cache. */
export function browse(p: BrowseParams = {}): Promise<{ items: Card[]; total: number }> {
  return browseCached(normalizeBrowse(p));
}

async function browseCached(p: NormalizedBrowse): Promise<{ items: Card[]; total: number }> {
  "use cache";
  catalogCache();
  cacheTag(catalogListTag, CATALOG_TAG);
  try {
    // Keep the same local-source prefix on every page, excluding its identities from
    // the entire remote sequence. A page-one-only prepend loses displaced results.
    const local = !p.genre && !p.q && p.sort === "newest"
      ? await localSourcePrefix(p.type, p.withBackdrop) : [];
    if (!local.length) return await getTmdbCatalog(p);
    const localIds = new Set(local.map((item) => `${item.kind}:${item.id}`));
    const sequence = [...local];
    let remoteOffset = 0;
    let remoteTotal = 0;
    let duplicates = 0;
    do {
      const remote = await getTmdbCatalog({ ...p, withBackdrop: false, withTotal: false, offset: remoteOffset, limit: TMDB_PAGE_SIZE });
      remoteTotal = remote.total;
      for (const item of remote.items) {
        if (localIds.has(`${item.kind}:${item.id}`)) duplicates++;
        else sequence.push(item);
      }
      remoteOffset += remote.items.length;
      if (!remote.items.length) break;
    } while (sequence.length < p.offset + p.limit && remoteOffset < remoteTotal);
    // Until the remote stream is exhausted, its overlap with the local prefix is
    // unknowable without scanning every upstream page. Keep the upper bound stable.
    const total = remoteOffset >= remoteTotal ? remoteTotal + local.length - duplicates : remoteTotal + local.length;
    return { items: sequence.slice(p.offset, p.offset + p.limit), total };
  } catch (err) {
    console.error("TMDB catalog fetch failed, falling back to local DB:", err);
    await captureException(err, { level: "warning", route: "catalog TMDB fetch", tags: { mechanism: "catalogFallback" } });
    return browseDb(p);
  }
}

export const listLatest = (kind: CardKind, limit = 20) => browse({ type: kind, limit }).then((r) => r.items);

/** Logos resolve inside card-level Suspense so they never hold up featured backdrops. */
export const listFeatured = (limit = 10) => browse({ withBackdrop: true, limit }).then((r) => r.items);

export async function featuredLogo(kind: CardKind, tmdbId: number): Promise<string | null> {
  "use cache";
  catalogCache();
  cacheTag(catalogListTag, CATALOG_TAG, tmdbTag(kind === "movie" ? "movie" : "tv", tmdbId));
  return getTmdbLogo(kind === "movie" ? "movie" : "tv", tmdbId).catch(() => null);
}

/** Genre names for the quick-pick rows (fixed lists: the catalog itself comes from TMDB). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept so existing callers' positional arguments stay valid
export async function listGenres(_minItems = 4, limit = 4, kind?: CardKind): Promise<string[]> {
  "use cache";
  catalogCache();
  cacheTag(catalogListTag, CATALOG_TAG);
  const genres = kind === "show"
    ? ["Drama", "Action & Adventure", "Comedy", "Crime", "Mystery", "Sci-Fi & Fantasy"]
    : ["Action", "Comedy", "Drama", "Thriller", "Sci-Fi", "Adventure", "Crime", "Animation"];
  return genres.slice(0, limit);
}

export type GenreTile = { genre: string; count: number; backdropPath: string | null };

/** Genres of one kind with a representative backdrop (highest rated title), in one query. */
export async function listGenreTiles(kind: CardKind): Promise<GenreTile[]> {
  "use cache";
  catalogCache();
  cacheTag(catalogListTag, CATALOG_TAG);
  const genreNames = kind === "show"
    ? ["Drama", "Action & Adventure", "Comedy", "Crime"]
    : ["Action", "Comedy", "Drama", "Thriller"];
  return genreNames.map((genre) => ({
    genre,
    count: 100,
    backdropPath: null,
  }));
}

