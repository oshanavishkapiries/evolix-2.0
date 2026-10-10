import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { movies, videos } from "@/db/schema";
import type { movieCreate } from "./schemas";
import { videoRows } from "./videos";

export async function listMovies() {
  return db
    .select({
      id: movies.id,
      tmdbId: movies.tmdbId,
      title: movies.title,
      releaseDate: movies.releaseDate,
      posterPath: movies.posterPath,
      isPublished: movies.isPublished,
    })
    .from(movies)
    .orderBy(desc(movies.createdAt));
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
