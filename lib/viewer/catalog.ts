import { AUDIO_LANGUAGES } from "@/lib/audio";
import { catalogCache } from "./cache";
import { and, count, eq, ilike, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { movies, shows } from "@/db/schema";
import { escapeLike } from "@/lib/cms/search";
import { getDiscoverMedia, getKidsMedia, getPopularMedia, getTmdbLogo, getTrendingMedia, searchKidsMedia, searchMovies, searchShows, type KidsSort, type TmdbCatalogItem } from "@/lib/tmdb";
import type { CardKind } from "./ids";

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

/** Which section a query is for: the main app, or the Kids section. Kids titles never show in "main". */
export type Scope = "main" | "kids";

export type Sort = "newest" | "title" | "year";
export const SORTS: Sort[] = ["newest", "title", "year"];
export type TypeFilter = "all" | CardKind;
export const SEARCH_PAGE_SIZE = 24;
export const MIN_QUERY = 2;

type Filters = { q?: string; genre?: string; withBackdrop?: boolean; scope?: Scope };

/** Same output columns for movies and shows so the two can be UNIONed. */
function cardQuery(kind: CardKind, f: Filters) {
  const t =
    kind === "movie"
      ? { table: movies, title: movies.title, original: movies.originalTitle, date: movies.releaseDate }
      : { table: shows, title: shows.name, original: shows.originalName, date: shows.firstAirDate };
  const { table } = t;
  return {
    where: whereFor(table.isPublished, table.audience, table.genres, table.backdropPath, [t.title, t.original], f, hasSourcesOf(kind)),
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

/** Kids titles are listed in the Kids section only (or both); everything else in the main app. */
export const audienceIn = (col: AnyColumn | SQL, scope: Scope | "all" = "main") =>
  scope === "all" ? sql`true` : scope === "kids" ? sql`${col} in ('kids', 'both')` : sql`${col} in ('general', 'both')`;

function whereFor(published: AnyColumn, audience: AnyColumn, genres: AnyColumn, backdrop: AnyColumn, textColumns: AnyColumn[], f: Filters, cached: SQL): SQL | undefined {
  // Evo creates a row for every title someone plays or bookmarks; only titles with a cached source are catalog entries.
  const parts: (SQL | undefined)[] = [eq(published, true), cached, audienceIn(audience, f.scope)];
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

export const TMDB_GENRES: Record<string, number> = {
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

/** Published titles directly from the local PostgreSQL database (used for Kids section and fallbacks). */
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

/** TMDB items -> cards; titles already cached locally link to their catalog row instead of `tmdb-N`. */
async function tmdbCards(tmdbItems: (TmdbCatalogItem & { kind: CardKind })[], limit: number): Promise<Card[]> {
  // Cross-reference with local database: a title with a cached source is served by its row, the rest are on-demand (Evo)
  const movieTmdbIds = tmdbItems.filter((i) => i.kind === "movie").map((i) => i.tmdbId).filter(Boolean);
  const showTmdbIds = tmdbItems.filter((i) => i.kind === "show").map((i) => i.tmdbId).filter(Boolean);

  const [localMovies, localShows] = await Promise.all([
    movieTmdbIds.length > 0
      ? db.select({ id: movies.id, tmdbId: movies.tmdbId, hasSources: hasSourcesOf("movie") }).from(movies).where(inArray(movies.tmdbId, movieTmdbIds))
      : [],
    showTmdbIds.length > 0
      ? db.select({ id: shows.id, tmdbId: shows.tmdbId, hasSources: hasSourcesOf("show") }).from(shows).where(inArray(shows.tmdbId, showTmdbIds))
      : [],
  ]);

  const movieMap = new Map(localMovies.map((m) => [m.tmdbId, m]));
  const showMap = new Map(localShows.map((s) => [s.tmdbId, s]));

  const cards: Card[] = tmdbItems.slice(0, limit).map((item) => {
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

/** Fetches catalog items from TMDB and cross-references with local DB for manual sources. */
async function getTmdbCatalog(p: BrowseParams): Promise<{ items: Card[]; total: number }> {
  const type = p.type ?? "all";
  const limit = p.limit ?? SEARCH_PAGE_SIZE;
  const page = Math.floor((p.offset ?? 0) / limit) + 1;
  const genreId = p.genre ? TMDB_GENRES[p.genre] : undefined;

  let tmdbItems: (TmdbCatalogItem & { kind: CardKind })[] = [];
  let total = 0;

  if (p.q && p.q.trim().length >= MIN_QUERY) {
    if (type === "show") {
      const sp = await searchShows(p.q, page);
      tmdbItems = sp.results.map((r) => ({ ...r, kind: "show" as CardKind, date: r.year ? `${r.year}-01-01` : null, backdropPath: null, rating: null }));
      total = sp.totalPages * 20;
    } else if (type === "movie") {
      const sp = await searchMovies(p.q, page);
      tmdbItems = sp.results.map((r) => ({ ...r, kind: "movie" as CardKind, date: r.year ? `${r.year}-01-01` : null, backdropPath: null, rating: null }));
      total = sp.totalPages * 20;
    } else {
      const [m, s] = await Promise.all([searchMovies(p.q, page), searchShows(p.q, page)]);
      const mItems = m.results.map((r) => ({ ...r, kind: "movie" as CardKind, date: r.year ? `${r.year}-01-01` : null, backdropPath: null, rating: null }));
      const sItems = s.results.map((r) => ({ ...r, kind: "show" as CardKind, date: r.year ? `${r.year}-01-01` : null, backdropPath: null, rating: null }));
      tmdbItems = [...mItems, ...sItems];
      total = (m.totalPages + s.totalPages) * 20;
    }
  } else if (genreId) {
    if (type === "show") {
      const sp = await getDiscoverMedia("tv", { withGenres: String(genreId), page });
      tmdbItems = sp.items.map((i) => ({ ...i, kind: "show" as CardKind }));
      total = sp.totalResults;
    } else {
      const sp = await getDiscoverMedia("movie", { withGenres: String(genreId), page });
      tmdbItems = sp.items.map((i) => ({ ...i, kind: "movie" as CardKind }));
      total = sp.totalResults;
    }
  } else if (p.sort === "newest" || p.withBackdrop) {
    if (type === "show") {
      const sp = await getTrendingMedia("tv", "week", page);
      tmdbItems = sp.items.map((i) => ({ ...i, kind: "show" as CardKind }));
      total = sp.totalResults;
    } else if (type === "movie") {
      const sp = await getTrendingMedia("movie", "week", page);
      tmdbItems = sp.items.map((i) => ({ ...i, kind: "movie" as CardKind }));
      total = sp.totalResults;
    } else {
      const [m, s] = await Promise.all([getTrendingMedia("movie", "week", page), getTrendingMedia("tv", "week", page)]);
      tmdbItems = [...m.items.map((i) => ({ ...i, kind: "movie" as CardKind })), ...s.items.map((i) => ({ ...i, kind: "show" as CardKind }))];
      total = m.totalResults + s.totalResults;
    }
  } else {
    if (type === "show") {
      const sp = await getPopularMedia("tv", page);
      tmdbItems = sp.items.map((i) => ({ ...i, kind: "show" as CardKind }));
      total = sp.totalResults;
    } else if (type === "movie") {
      const sp = await getPopularMedia("movie", page);
      tmdbItems = sp.items.map((i) => ({ ...i, kind: "movie" as CardKind }));
      total = sp.totalResults;
    } else {
      const [m, s] = await Promise.all([getPopularMedia("movie", page), getPopularMedia("tv", page)]);
      tmdbItems = [...m.items.map((i) => ({ ...i, kind: "movie" as CardKind })), ...s.items.map((i) => ({ ...i, kind: "show" as CardKind }))];
      total = m.totalResults + s.totalResults;
    }
  }

  return { items: await tmdbCards(tmdbItems, limit), total };
}

/** Kids section: the TMDB kids catalog (see getKidsMedia), browsed, searched and genre-filtered like the main one. */
async function getKidsCatalog(p: BrowseParams): Promise<{ items: Card[]; total: number }> {
  const type = p.type ?? "all";
  const limit = p.limit ?? SEARCH_PAGE_SIZE;
  const page = Math.floor((p.offset ?? 0) / limit) + 1;
  const genre = p.genre ? TMDB_GENRES[p.genre] : undefined;
  const sort: KidsSort = p.sort === "title" ? "title" : p.sort === "newest" || p.sort === "year" ? "newest" : "popular";
  const searching = Boolean(p.q && p.q.trim().length >= MIN_QUERY);
  const fetchKind = (kind: "movie" | "tv") => (searching ? searchKidsMedia(kind, p.q!.trim(), page) : getKidsMedia(kind, { genre, sort, page }));

  const kinds = type === "movie" ? (["movie"] as const) : type === "show" ? (["tv"] as const) : (["movie", "tv"] as const);
  const pages = await Promise.all(kinds.map(fetchKind));
  let items = pages.flatMap((pg, i) => pg.items.map((it) => ({ ...it, kind: (kinds[i] === "movie" ? "movie" : "show") as CardKind })));
  if (p.withBackdrop) items = items.filter((i) => i.backdropPath);
  // Movies and shows alternate in the combined view instead of one block after the other.
  if (kinds.length === 2) {
    const [m, t] = [items.filter((i) => i.kind === "movie"), items.filter((i) => i.kind === "show")];
    items = Array.from({ length: Math.max(m.length, t.length) }, (_, i) => [m[i], t[i]]).flat().filter(Boolean) as typeof items;
  }
  return { items: await tmdbCards(items, limit), total: pages.reduce((n, pg) => n + pg.totalResults, 0) };
}

/** Published titles (movies and/or shows), filtered, sorted and paged. */
export async function browse(p: BrowseParams = {}): Promise<{ items: Card[]; total: number }> {
  "use cache";
  catalogCache();
  const scope = p.scope ?? "main";

  // Hybrid catalog: TMDB (the main catalog, or the kids catalog for the Kids section) plus titles already cached locally.
  try {
    const tmdbRes = scope === "kids" ? await getKidsCatalog(p) : await getTmdbCatalog(p);

    // On page 1 (no search query or genre filter), prepend any local manual titles for the main section
    if ((p.offset ?? 0) === 0 && !p.genre && !p.q) {
      const localManual = await browseDb({ ...p, limit: 10, offset: 0, scope });
      const localWithSources = localManual.items.filter((item) => !item.isEvo);
      if (localWithSources.length > 0) {
        const localIds = new Set(localWithSources.map((i) => i.id));
        const filteredTmdb = tmdbRes.items.filter((i) => !localIds.has(i.id));
        return {
          items: [...localWithSources, ...filteredTmdb].slice(0, p.limit ?? SEARCH_PAGE_SIZE),
          total: tmdbRes.total + localWithSources.length,
        };
      }
    }

    return tmdbRes;
  } catch (err) {
    console.error("TMDB catalog fetch failed, falling back to local DB:", err);
    return browseDb(p);
  }
}

export const listLatest = (kind: CardKind, limit = 20, scope?: Scope) => browse({ type: kind, limit, scope }).then((r) => r.items);

/** Home "Featured" row: newest titles that have a backdrop (curation can replace this later). */
export const listFeatured = (limit = 10, scope?: Scope) => browse({ withBackdrop: true, limit, scope }).then((r) => withLogos(r.items));

/** TMDB list endpoints carry no title logos: fetch them for the on-demand items so Featured cards can show them. */
async function withLogos(items: Card[]): Promise<Card[]> {
  "use cache";
  catalogCache();
  return Promise.all(
    items.map(async (item) => {
      const m = /^tmdb-(\d+)$/.exec(item.id);
      if (item.logoPath || !m) return item;
      const logoPath = await getTmdbLogo(item.kind === "movie" ? "movie" : "tv", Number(m[1])).catch(() => null);
      return { ...item, logoPath };
    }),
  );
}

/** Genres offered in the Kids section; each maps to a TMDB genre id (see TMDB_GENRES). */
const KIDS_GENRES = ["Animation", "Comedy", "Adventure", "Fantasy", "Family", "Science Fiction", "Music"];

/** Genre names for the quick-pick rows (fixed lists: the catalog itself comes from TMDB). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept so existing callers' positional arguments stay valid
export async function listGenres(_minItems = 4, limit = 4, kind?: CardKind, scope: Scope = "main"): Promise<string[]> {
  "use cache";
  catalogCache();
  if (scope === "kids") return KIDS_GENRES.slice(0, limit);

  const genres = kind === "show"
    ? ["Drama", "Action & Adventure", "Comedy", "Crime", "Mystery", "Sci-Fi & Fantasy"]
    : ["Action", "Comedy", "Drama", "Thriller", "Sci-Fi", "Adventure", "Crime", "Animation"];
  return genres.slice(0, limit);
}

export type GenreTile = { genre: string; count: number; backdropPath: string | null };

/** Genres of one kind with a representative backdrop (highest rated title), in one query. */
export async function listGenreTiles(kind: CardKind, scope: Scope = "main"): Promise<GenreTile[]> {
  "use cache";
  catalogCache();
  if (scope === "kids") return KIDS_GENRES.map((genre) => ({ genre, count: 100, backdropPath: null }));

  const genreNames = kind === "show"
    ? ["Drama", "Action & Adventure", "Comedy", "Crime"]
    : ["Action", "Comedy", "Drama", "Thriller"];
  return genreNames.map((genre) => ({
    genre,
    count: 100,
    backdropPath: null,
  }));
}

