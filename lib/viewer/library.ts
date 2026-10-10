import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookmarks, episodes, movies, seasons, shows, watchProgress } from "@/db/schema";
import type { Card } from "./catalog";

/** A position this far in counts as finished. */
export const COMPLETE_RATIO = 0.9;
/** Ignore the first seconds so an accidental open does not create a resume point. */
export const MIN_RESUME_SECONDS = 10;

export type ContinueItem = {
  key: string;
  title: string;
  /** e.g. "S1:E3 - Pilot"; empty for movies. */
  label: string;
  posterPath: string | null;
  /** Landscape image: episode still for shows when there is one, else the title backdrop. */
  backdropPath: string | null;
  /** Minutes left in the current item (null when unknown or not started). */
  leftMinutes: number | null;
  href: string;
  /** 0-100; 0 for "up next" episodes that were not started. */
  percent: number;
  detailHref: string;
};

export async function bookmarkIds(userId: string) {
  const rows = await db
    .select({ movieId: bookmarks.movieId, showId: bookmarks.showId })
    .from(bookmarks)
    .where(eq(bookmarks.userId, userId));
  return {
    movies: rows.flatMap((r) => (r.movieId ? [r.movieId] : [])),
    shows: rows.flatMap((r) => (r.showId ? [r.showId] : [])),
  };
}

/** Bookmarked, still-published titles, newest bookmark first. */
export async function listBookmarks(userId: string, limit = 200): Promise<Card[]> {
  const [m, s] = await Promise.all([
    db
      .select({
        id: movies.id,
        title: movies.title,
        date: movies.releaseDate,
        posterPath: movies.posterPath,
        backdropPath: movies.backdropPath,
        rating: movies.rating,
        at: bookmarks.createdAt,
      })
      .from(bookmarks)
      .innerJoin(movies, eq(movies.id, bookmarks.movieId))
      .where(and(eq(bookmarks.userId, userId), eq(movies.isPublished, true)))
      .orderBy(desc(bookmarks.createdAt))
      .limit(limit),
    db
      .select({
        id: shows.id,
        title: shows.name,
        date: shows.firstAirDate,
        posterPath: shows.posterPath,
        backdropPath: shows.backdropPath,
        rating: shows.rating,
        at: bookmarks.createdAt,
      })
      .from(bookmarks)
      .innerJoin(shows, eq(shows.id, bookmarks.showId))
      .where(and(eq(bookmarks.userId, userId), eq(shows.isPublished, true)))
      .orderBy(desc(bookmarks.createdAt))
      .limit(limit),
  ]);
  return [...m.map((r) => ({ ...r, kind: "movie" as const })), ...s.map((r) => ({ ...r, kind: "show" as const }))]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit)
    .map((r) => ({ kind: r.kind, id: r.id, title: r.title, date: r.date, posterPath: r.posterPath, backdropPath: r.backdropPath, rating: r.rating }));
}

/** Saved position for one movie/episode, or 0 when none, finished, or barely started. */
export async function resumePosition(userId: string, target: { movieId: string } | { episodeId: string }) {
  const [row] = await db
    .select({ position: watchProgress.positionSeconds, completed: watchProgress.completed })
    .from(watchProgress)
    .where(
      and(
        eq(watchProgress.userId, userId),
        "movieId" in target ? eq(watchProgress.movieId, target.movieId) : eq(watchProgress.episodeId, target.episodeId),
      ),
    )
    .limit(1);
  return row && !row.completed && row.position >= MIN_RESUME_SECONDS ? row.position : 0;
}

const code = (s: number, e: number) => `S${s}:E${e}`;

/**
 * Unfinished movies plus one entry per show: the episode being watched, or the next visible
 * episode after a finished one. Most recent first.
 */
export async function continueWatching(userId: string, limit = 20): Promise<ContinueItem[]> {
  const [movieRows, episodeRows] = await Promise.all([
    db
      .select({
        id: movies.id,
        title: movies.title,
        posterPath: movies.posterPath,
        backdropPath: movies.backdropPath,
        position: watchProgress.positionSeconds,
        duration: watchProgress.durationSeconds,
        at: watchProgress.updatedAt,
      })
      .from(watchProgress)
      .innerJoin(movies, eq(movies.id, watchProgress.movieId))
      .where(
        and(
          eq(watchProgress.userId, userId),
          eq(watchProgress.completed, false),
          sql`${watchProgress.positionSeconds} >= ${MIN_RESUME_SECONDS}`,
          eq(movies.isPublished, true),
        ),
      )
      .orderBy(desc(watchProgress.updatedAt))
      .limit(limit),
    db
      .select({
        showId: shows.id,
        showName: shows.name,
        posterPath: shows.posterPath,
        backdropPath: shows.backdropPath,
        seasonNumber: seasons.seasonNumber,
        episodeNumber: episodes.episodeNumber,
        episodeName: episodes.name,
        stillPath: episodes.stillPath,
        position: watchProgress.positionSeconds,
        duration: watchProgress.durationSeconds,
        completed: watchProgress.completed,
        at: watchProgress.updatedAt,
      })
      .from(watchProgress)
      .innerJoin(episodes, eq(episodes.id, watchProgress.episodeId))
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .innerJoin(shows, eq(shows.id, seasons.showId))
      .where(
        and(
          eq(watchProgress.userId, userId),
          eq(shows.isPublished, true),
          eq(seasons.isVisible, true),
          eq(episodes.isVisible, true),
        ),
      )
      .orderBy(desc(watchProgress.updatedAt))
      .limit(100),
  ]);

  const pct = (p: number, d: number) => (d > 0 ? Math.min(99, Math.max(1, Math.round((p / d) * 100))) : 0);
  const left = (p: number, d: number) => (d > 0 && p > 0 ? Math.max(1, Math.round((d - p) / 60)) : null);
  const items: (ContinueItem & { at: number })[] = movieRows.map((r) => ({
    key: `m-${r.id}`,
    title: r.title,
    label: "",
    posterPath: r.posterPath,
    backdropPath: r.backdropPath,
    leftMinutes: left(r.position, r.duration),
    href: `/watch/movie/${r.id}`,
    detailHref: `/movie/${r.id}`,
    percent: pct(r.position, r.duration),
    at: r.at.getTime(),
  }));

  // Latest row per show (rows are newest first).
  const latest = new Map<string, (typeof episodeRows)[number]>();
  for (const r of episodeRows) if (!latest.has(r.showId)) latest.set(r.showId, r);

  const finished = [...latest.values()].filter((r) => r.completed);
  const order = new Map<string, { seasonNumber: number; episodeNumber: number; name: string; stillPath: string | null }[]>();
  if (finished.length) {
    const all = await db
      .select({
        showId: seasons.showId,
        seasonNumber: seasons.seasonNumber,
        episodeNumber: episodes.episodeNumber,
        name: episodes.name,
        stillPath: episodes.stillPath,
      })
      .from(episodes)
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .where(
        and(
          inArray(seasons.showId, finished.map((r) => r.showId)),
          eq(seasons.isVisible, true),
          eq(episodes.isVisible, true),
        ),
      )
      .orderBy(seasons.seasonNumber, episodes.episodeNumber);
    for (const e of all) order.set(e.showId, [...(order.get(e.showId) ?? []), e]);
  }

  for (const r of latest.values()) {
    let ep = { seasonNumber: r.seasonNumber, episodeNumber: r.episodeNumber, name: r.episodeName, stillPath: r.stillPath };
    let percent = pct(r.position, r.duration);
    let leftMinutes = left(r.position, r.duration);
    if (r.completed) {
      const list = order.get(r.showId) ?? [];
      const i = list.findIndex((e) => e.seasonNumber === r.seasonNumber && e.episodeNumber === r.episodeNumber);
      const next = list[i + 1];
      if (!next) continue; // nothing left to watch
      ep = next;
      percent = 0;
      leftMinutes = null;
    } else if (r.position < MIN_RESUME_SECONDS) continue;
    items.push({
      key: `s-${r.showId}`,
      title: r.showName,
      label: `${code(ep.seasonNumber, ep.episodeNumber)}${ep.name ? ` - ${ep.name}` : ""}`,
      posterPath: r.posterPath,
      backdropPath: ep.stillPath ?? r.backdropPath,
      leftMinutes,
      href: `/watch/tv/${r.showId}/${ep.seasonNumber}/${ep.episodeNumber}`,
      detailHref: `/tv/${r.showId}`,
      percent,
      at: r.at.getTime(),
    });
  }

  return items
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((it) => ({ key: it.key, title: it.title, label: it.label, posterPath: it.posterPath, backdropPath: it.backdropPath, leftMinutes: it.leftMinutes, href: it.href, percent: it.percent, detailHref: it.detailHref }));
}
