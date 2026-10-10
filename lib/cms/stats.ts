import { count, sql } from "drizzle-orm";
import { db } from "@/db";
import { movies, shows } from "@/db/schema";
import { listMovies } from "./movies";
import { listShows } from "./shows";

const published = (col: typeof movies.isPublished | typeof shows.isPublished) =>
  sql<number>`count(*) filter (where ${col})`.mapWith(Number);

/** Dashboard numbers: totals, published counts and the five newest titles of each kind. */
export async function adminOverview() {
  const [[m], [s], recentMovies, recentShows] = await Promise.all([
    db.select({ total: count(), published: published(movies.isPublished) }).from(movies),
    db.select({ total: count(), published: published(shows.isPublished) }).from(shows),
    listMovies({ page: 1, pageSize: 5 }),
    listShows({ page: 1, pageSize: 5 }),
  ]);
  return { movies: m, shows: s, recentMovies: recentMovies.rows, recentShows: recentShows.rows };
}
