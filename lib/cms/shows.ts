import { and, asc, count, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { db } from "@/db";
import { episodes, seasons, shows, videos } from "@/db/schema";
import type { showCreate } from "./schemas";
import { listWhere, pageWindow, type ListParams } from "./search";
import { listVideos, videoRows } from "./videos";

/** Shows newest first, optionally filtered (q, status) and paged; `total` ignores paging. */
export async function listShows(params: ListParams = {}) {
  const where = listWhere(params, [shows.name, shows.originalName], shows.isPublished);
  const win = pageWindow(params);
  const query = db
    .select({
      id: shows.id,
      tmdbId: shows.tmdbId,
      name: shows.name,
      firstAirDate: shows.firstAirDate,
      posterPath: shows.posterPath,
      isPublished: shows.isPublished,
    })
    .from(shows)
    .where(where)
    .orderBy(desc(shows.createdAt), desc(shows.id))
    .$dynamic();
  const [rows, [{ total }]] = await Promise.all([
    win ? query.limit(win.limit).offset(win.offset) : query,
    db.select({ total: count() }).from(shows).where(where),
  ]);
  return { rows, total, page: win?.page ?? 1, pageSize: win?.pageSize ?? rows.length };
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
    videos: await listVideos({ showId: id }),
    seasons: seasonRows.map((s) => ({
      ...s,
      episodes: episodeRows.filter((e) => e.seasonId === s.id),
    })),
  };
}

/** Inserts show + seasons + episodes in one atomic HTTP batch. */
export async function createShowTree(input: z.infer<typeof showCreate>) {
  const { seasons: seasonInput, videos: videoInput, ...showFields } = input;
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
  const videoValues = videoRows({ showId }, videoInput);
  if (videoValues.length) stmts.push(db.insert(videos).values(videoValues).onConflictDoNothing() as never);
  await db.batch(stmts as [(typeof stmts)[0], ...(typeof stmts)[0][]]);
  return showId;
}

/** Seasons of a show (by number) with their episode counts. */
export async function listSeasonsWithCounts(showId: string) {
  return db
    .select({ ...getTableColumns(seasons), episodeCount: count(episodes.id) })
    .from(seasons)
    .leftJoin(episodes, eq(episodes.seasonId, seasons.id))
    .where(eq(seasons.showId, showId))
    .groupBy(seasons.id)
    .orderBy(asc(seasons.seasonNumber));
}

/** One season with all its episodes, each with source and subtitle counts; null when the season does not exist. */
export async function getSeasonDetail(showId: string, seasonNumber: number) {
  const [season] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.showId, showId), eq(seasons.seasonNumber, seasonNumber)))
    .limit(1);
  if (!season) return null;
  const rows = await db
    .select({
      ...getTableColumns(episodes),
      sourceCount: sql<number>`(select count(*) from sources where sources.episode_id = ${episodes.id})`.mapWith(Number),
      subtitleCount: sql<number>`(select count(*) from subtitles where subtitles.episode_id = ${episodes.id})`.mapWith(Number),
    })
    .from(episodes)
    .where(eq(episodes.seasonId, season.id))
    .orderBy(asc(episodes.episodeNumber));
  return { season, episodes: rows };
}

/** One episode with its neighbours inside the season; null when season or episode is missing. */
export async function getEpisodeDetail(showId: string, seasonNumber: number, episodeNumber: number) {
  const detail = await getSeasonDetail(showId, seasonNumber);
  if (!detail) return null;
  const i = detail.episodes.findIndex((e) => e.episodeNumber === episodeNumber);
  if (i < 0) return null;
  const nav = (e?: { episodeNumber: number; name: string }) => (e ? { episodeNumber: e.episodeNumber, name: e.name } : null);
  return {
    season: detail.season,
    episode: detail.episodes[i],
    prev: nav(detail.episodes[i - 1]),
    next: nav(detail.episodes[i + 1]),
  };
}
