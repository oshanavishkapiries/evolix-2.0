import { asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import type { showCreate } from "./schemas";

export async function listShows() {
  return db
    .select({
      id: shows.id,
      tmdbId: shows.tmdbId,
      name: shows.name,
      firstAirDate: shows.firstAirDate,
      posterPath: shows.posterPath,
      isPublished: shows.isPublished,
    })
    .from(shows)
    .orderBy(desc(shows.createdAt));
}

export async function getShow(id: string) {
  const [row] = await db.select().from(shows).where(eq(shows.id, id)).limit(1);
  return row ?? null;
}

export async function findShowIdByTmdb(tmdbId: number) {
  const [row] = await db
    .select({ id: shows.id })
    .from(shows)
    .where(eq(shows.tmdbId, tmdbId))
    .limit(1);
  return row?.id ?? null;
}

/** Show with nested seasons and episodes, ordered by number. */
export async function getShowTree(id: string) {
  const show = await getShow(id);
  if (!show) return null;
  const seasonRows = await db
    .select()
    .from(seasons)
    .where(eq(seasons.showId, id))
    .orderBy(asc(seasons.seasonNumber));
  const episodeRows = seasonRows.length
    ? await db
        .select()
        .from(episodes)
        .where(inArray(episodes.seasonId, seasonRows.map((s) => s.id)))
        .orderBy(asc(episodes.episodeNumber))
    : [];
  return {
    ...show,
    seasons: seasonRows.map((s) => ({
      ...s,
      episodes: episodeRows.filter((e) => e.seasonId === s.id),
    })),
  };
}

/** Inserts show + seasons + episodes in one atomic HTTP batch. */
export async function createShowTree(input: z.infer<typeof showCreate>) {
  const { seasons: seasonInput, ...showFields } = input;
  const showId = randomUUID();

  const seasonRows = seasonInput.map((s) => ({
    id: randomUUID(),
    showId,
    tmdbId: s.tmdbId,
    seasonNumber: s.seasonNumber,
    name: s.name,
    overview: s.overview,
    airDate: s.airDate,
    posterPath: s.posterPath,
    isVisible: s.isVisible,
  }));
  const episodeRows = seasonInput.flatMap((s, i) =>
    s.episodes.map((e) => ({ ...e, id: randomUUID(), seasonId: seasonRows[i].id })),
  );

  const stmts = [db.insert(shows).values({ ...showFields, id: showId })];
  if (seasonRows.length) stmts.push(db.insert(seasons).values(seasonRows) as never);
  for (let i = 0; i < episodeRows.length; i += 1000) {
    stmts.push(db.insert(episodes).values(episodeRows.slice(i, i + 1000)) as never);
  }
  await db.batch(stmts as [(typeof stmts)[0], ...(typeof stmts)[0][]]);
  return showId;
}
