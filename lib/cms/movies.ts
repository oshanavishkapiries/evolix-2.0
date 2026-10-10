import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { movies, videos } from "@/db/schema";
import type { movieCreate } from "./schemas";
import { listWhere, pageWindow, type ListParams } from "./search";
import { videoRows } from "./videos";

/** Movies newest first, optionally filtered (q, status) and paged; `total` ignores paging. */
export async function listMovies(params: ListParams = {}) {
  const where = listWhere(params, [movies.title, movies.originalTitle], movies.isPublished);
  const win = pageWindow(params);
  const query = db
    .select({
      id: movies.id,
      tmdbId: movies.tmdbId,
      title: movies.title,
      releaseDate: movies.releaseDate,
      posterPath: movies.posterPath,
      isPublished: movies.isPublished,
    })
    .from(movies)
    .where(where)
    .orderBy(desc(movies.createdAt), desc(movies.id))
    .$dynamic();
  const [rows, [{ total }]] = await Promise.all([
    win ? query.limit(win.limit).offset(win.offset) : query,
    db.select({ total: count() }).from(movies).where(where),
  ]);
  return { rows, total, page: win?.page ?? 1, pageSize: win?.pageSize ?? rows.length };
}

export async function getMovie(id: string) {
  const [row] = await db.select().from(movies).where(eq(movies.id, id)).limit(1);
  return row ?? null;
}

export async function findMovieIdByTmdb(tmdbId: number) {
  const [row] = await db
    .select({ id: movies.id })
    .from(movies)
    .where(eq(movies.tmdbId, tmdbId))
    .limit(1);
  return row?.id ?? null;
}

/** Inserts a movie and its videos in one atomic HTTP batch; returns the movie row. */
export async function createMovieWithVideos(input: z.infer<typeof movieCreate>) {
  const { videos: videoInput, ...fields } = input;
  const id = randomUUID();
  const rows = videoRows({ movieId: id }, videoInput);
  const insertMovie = db.insert(movies).values({ ...fields, id }).returning();
  if (!rows.length) return (await insertMovie)[0];
  const [movieRows] = await db.batch([
    insertMovie,
    db.insert(videos).values(rows).onConflictDoNothing(),
  ]);
  return movieRows[0];
}
