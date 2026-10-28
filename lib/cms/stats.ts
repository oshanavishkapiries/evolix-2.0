import { count, sql } from "drizzle-orm";
import { db } from "@/db";
import { movies, reports, shows, users, watchProgress } from "@/db/schema";
import { listMovies } from "./movies";
import { listShows } from "./shows";
import { tzDay } from "@/lib/tz";

const published = (col: typeof movies.isPublished | typeof shows.isPublished) =>
  sql<number>`count(*) filter (where ${col})`.mapWith(Number);

/** Dashboard numbers: totals, published counts, open viewer reports and the five newest titles of each kind. */
export async function adminOverview() {
  const [[m], [s], [r], recentMovies, recentShows] = await Promise.all([
    db.select({ total: count(), published: published(movies.isPublished) }).from(movies),
    db.select({ total: count(), published: published(shows.isPublished) }).from(shows),
    db
      .select({
        open: sql<number>`count(*) filter (where ${reports.status} = 'open')`.mapWith(Number),
        new24: sql<number>`count(*) filter (where ${reports.status} = 'open' and ${reports.createdAt} > now() - interval '24 hours')`.mapWith(Number),
      })
      .from(reports),
    listMovies({ page: 1, pageSize: 5 }),
    listShows({ page: 1, pageSize: 5 }),
  ]);
  return { movies: m, shows: s, reports: r, recentMovies: recentMovies.rows, recentShows: recentShows.rows };
}

/** Rough streaming volume: no per-request traffic is stored, so it is derived from watched seconds. */
export const GB_PER_HOUR = 1.5;
export const COST_PER_GB = 0.01;
const DAYS = 14;

export type DayPoint = { day: string; plays: number; viewers: number; signups: number; hours: number; gb: number; cost: number };

/** One point per Sri Lanka day for the last 14 days, oldest first; days with no data are zero. */
export async function adminAnalytics(): Promise<DayPoint[]> {
  const since = sql`(date_trunc('day', now() at time zone 'Asia/Colombo') - interval '${sql.raw(String(DAYS - 1))} days')`;
  const [watch, signups] = await Promise.all([
    db.execute(sql`
      select to_char(date_trunc('day', ${watchProgress.updatedAt} at time zone 'Asia/Colombo'), 'YYYY-MM-DD') as day,
             count(*)::int as plays,
             count(distinct ${watchProgress.userId})::int as viewers,
             coalesce(sum(${watchProgress.positionSeconds}), 0)::float as seconds
      from ${watchProgress}
      where ${watchProgress.updatedAt} at time zone 'Asia/Colombo' >= ${since}
      group by 1`),
    db.execute(sql`
      select to_char(date_trunc('day', ${users.createdAt} at time zone 'Asia/Colombo'), 'YYYY-MM-DD') as day, count(*)::int as n
      from ${users}
      where ${users.createdAt} at time zone 'Asia/Colombo' >= ${since}
      group by 1`),
  ]);
  const w = new Map((watch.rows as { day: string; plays: number; viewers: number; seconds: number }[]).map((r) => [r.day, r]));
  const u = new Map((signups.rows as { day: string; n: number }[]).map((r) => [r.day, r.n]));
  const out: DayPoint[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = tzDay(new Date(Date.now() - i * 86_400_000));
    const r = w.get(day);
    const hours = (r?.seconds ?? 0) / 3600;
    const gb = hours * GB_PER_HOUR;
    out.push({ day, plays: r?.plays ?? 0, viewers: r?.viewers ?? 0, signups: u.get(day) ?? 0, hours, gb, cost: gb * COST_PER_GB });
  }
  return out;
}
