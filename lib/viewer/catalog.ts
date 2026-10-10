import { and, count, eq, ilike, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { movies, shows } from "@/db/schema";
import { escapeLike } from "@/lib/cms/search";
import type { CardKind } from "./ids";

// Everything here only ever returns PUBLISHED titles.

export type Card = {
  kind: CardKind;
  id: string;
  title: string;
  date: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
};

export type Sort = "newest" | "title" | "year";
export const SORTS: Sort[] = ["newest", "title", "year"];
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
    where: whereFor(table.isPublished, table.genres, table.backdropPath, [t.title, t.original], f),
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
          rating: sql<number | null>`${table.rating}`.as("rating"),
          createdAt: sql<Date>`${table.createdAt}`.as("created_at"),
        })
        .from(table),
  };
}

function whereFor(published: AnyColumn, genres: AnyColumn, backdrop: AnyColumn, textColumns: AnyColumn[], f: Filters): SQL | undefined {
  const parts: (SQL | undefined)[] = [eq(published, true)];
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

/** Published titles (movies and/or shows), filtered, sorted and paged. */
export async function browse(p: BrowseParams = {}): Promise<{ items: Card[]; total: number }> {
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
    items: items.map(({ kind, id, title, date, posterPath, backdropPath, rating }) => ({ kind, id, title, date, posterPath, backdropPath, rating })),
    total,
  };
}

export const listLatest = (kind: CardKind, limit = 20) => browse({ type: kind, limit }).then((r) => r.items);

/** Home "Featured" row: newest titles that have a backdrop (curation can replace this later). */
export const listFeatured = (limit = 10) => browse({ withBackdrop: true, limit }).then((r) => r.items);

/** Genres shared by at least `minItems` published titles, most populated first. */
export async function listGenres(minItems = 4, limit = 4, kind?: CardKind): Promise<string[]> {
  const parts = [
    kind !== "show" && sql`select unnest(genres) as g from movies where is_published`,
    kind !== "movie" && sql`select unnest(genres) as g from shows where is_published`,
  ].filter((p): p is SQL => Boolean(p));
  const res = await db.execute(sql`
    select g as genre from (${sql.join(parts, sql` union all `)}) t
    where g <> ''
    group by g
    having count(*) >= ${minItems}
    order by count(*) desc, g asc
    limit ${limit}`);
  return (res.rows as { genre: string }[]).map((r) => r.genre);
}

export type GenreTile = { genre: string; count: number; backdropPath: string | null };

/** Genres of one kind with a representative backdrop (highest rated title), in one query. */
export async function listGenreTiles(kind: CardKind): Promise<GenreTile[]> {
  const table = kind === "movie" ? sql`movies` : sql`shows`;
  const res = await db.execute(sql`
    select genre, n::int as count, backdrop_path from (
      select distinct on (g) g as genre, backdrop_path, count(*) over (partition by g) as n
      from (select unnest(genres) as g, backdrop_path, rating from ${table} where is_published) t
      where g <> ''
      order by g, (backdrop_path is null), rating desc nulls last
    ) x
    order by n desc, genre asc`);
  return (res.rows as { genre: string; count: number; backdrop_path: string | null }[]).map((r) => ({
    genre: r.genre,
    count: r.count,
    backdropPath: r.backdrop_path,
  }));
}
