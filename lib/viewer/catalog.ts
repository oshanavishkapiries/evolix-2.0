import { and, count, eq, ilike, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { cache } from "react";
import { db } from "@/db";
import { movies, shows } from "@/db/schema";
import { escapeLike } from "@/lib/cms/search";
import type { CardKind } from "./ids";
import { firstEpisode } from "./detail";

// Everything here only ever returns PUBLISHED titles.

export type Card = {
  kind: CardKind;
  id: string;
  title: string;
  date: string | null;
  posterPath: string | null;
  rating: number | null;
};

export type Sort = "newest" | "title" | "year";
export const SORTS: Sort[] = ["newest", "title", "year"];
export type TypeFilter = "all" | CardKind;
export const SEARCH_PAGE_SIZE = 24;
export const MIN_QUERY = 2;

type Filters = { q?: string; genre?: string };

/** Same output columns for movies and shows so the two can be UNIONed. */
function cardQuery(kind: CardKind, f: Filters) {
  const t =
    kind === "movie"
      ? { table: movies, title: movies.title, original: movies.originalTitle, date: movies.releaseDate }
      : { table: shows, title: shows.name, original: shows.originalName, date: shows.firstAirDate };
  const { table } = t;
  return {
    where: whereFor(table.isPublished, table.genres, [t.title, t.original], f),
    select: () =>
      db
        .select({
          kind: sql<CardKind>`${kind}::text`.as("kind"),
          id: sql<string>`${table.id}`.as("id"),
          title: sql<string>`${t.title}`.as("title"),
          sortTitle: sql<string>`lower(${t.title})`.as("sort_title"),
          date: sql<string | null>`${t.date}`.as("date"),
          posterPath: sql<string | null>`${table.posterPath}`.as("poster_path"),
          rating: sql<number | null>`${table.rating}`.as("rating"),
          createdAt: sql<Date>`${table.createdAt}`.as("created_at"),
        })
        .from(table),
  };
}

function whereFor(published: AnyColumn, genres: AnyColumn, textColumns: AnyColumn[], f: Filters): SQL | undefined {
  const parts: (SQL | undefined)[] = [eq(published, true)];
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
    items: items.map(({ kind, id, title, date, posterPath, rating }) => ({ kind, id, title, date, posterPath, rating })),
    total,
  };
}

export const listLatest = (kind: CardKind, limit = 20) => browse({ type: kind, limit }).then((r) => r.items);

/** Genres shared by at least `minItems` published titles, most populated first. */
export async function listGenres(minItems = 4, limit = 4): Promise<string[]> {
  const res = await db.execute(sql`
    select g as genre from (
      select unnest(genres) as g from movies where is_published
      union all
      select unnest(genres) as g from shows where is_published
    ) t
    where g <> ''
    group by g
    having count(*) >= ${minItems}
    order by count(*) desc, g asc
    limit ${limit}`);
  return (res.rows as { genre: string }[]).map((r) => r.genre);
}

export type Hero = {
  kind: CardKind;
  id: string;
  title: string;
  tagline: string;
  overview: string;
  date: string | null;
  rating: number | null;
  runtimeMinutes: number | null;
  genres: string[];
  backdropPath: string;
  logoPath: string | null;
  playHref: string;
};

/** A random published title that has a backdrop (null when there is none). */
export const getHero = cache(async (): Promise<Hero | null> => {
  const [movie, show] = await Promise.all([
    db
      .select({
        id: movies.id,
        title: movies.title,
        tagline: movies.tagline,
        overview: movies.overview,
        date: movies.releaseDate,
        rating: movies.rating,
        runtimeMinutes: movies.runtimeMinutes,
        genres: movies.genres,
        backdropPath: movies.backdropPath,
        logoPath: movies.logoPath,
      })
      .from(movies)
      .where(and(eq(movies.isPublished, true), sql`${movies.backdropPath} is not null`))
      .orderBy(sql`random()`)
      .limit(1),
    db
      .select({
        id: shows.id,
        title: shows.name,
        tagline: shows.tagline,
        overview: shows.overview,
        date: shows.firstAirDate,
        rating: shows.rating,
        genres: shows.genres,
        backdropPath: shows.backdropPath,
        logoPath: shows.logoPath,
      })
      .from(shows)
      .where(and(eq(shows.isPublished, true), sql`${shows.backdropPath} is not null`))
      .orderBy(sql`random()`)
      .limit(1),
  ]);
  const picks = [
    ...movie.map((r) => ({ ...r, kind: "movie" as const })),
    ...show.map((r) => ({ ...r, kind: "show" as const, runtimeMinutes: null })),
  ];
  const pick = picks[Math.floor(Math.random() * picks.length)];
  if (!pick || !pick.backdropPath) return null;
  let playHref = `/watch/movie/${pick.id}`;
  if (pick.kind === "show") {
    const ep = await firstEpisode(pick.id);
    playHref = ep ? `/watch/tv/${pick.id}/${ep.seasonNumber}/${ep.episodeNumber}` : `/tv/${pick.id}`;
  }
  return { ...pick, backdropPath: pick.backdropPath, playHref };
});
