import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { movies } from "@/db/schema";

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
