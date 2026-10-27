import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const FEEDBACK_RANGES = [7, 30, 90] as const;
export type FeedbackRange = (typeof FEEDBACK_RANGES)[number];
const PAGE_SIZE = 25;

const q = async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)).rows as T[];
const since = (days: number) => sql`date_trunc('day', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo' - make_interval(days => ${days - 1})`;

export type FeedbackFilter = { rating?: number; comments?: boolean; page: number };

/** Everything the admin Feedback page shows, for one window of Sri Lanka days. */
export async function feedbackStats(days: FeedbackRange, f: FeedbackFilter) {
  const listWhere = sql.join(
    [
      sql`f.created_at >= ${since(days)}`,
      ...(f.rating ? [sql`f.rating = ${f.rating}`] : []),
      ...(f.comments ? [sql`f.comment <> ''`] : []),
    ],
    sql` and `,
  );
  const [kpis, dist, daily, tags, byQuality, byStalls, titles, list, [{ total }]] = await Promise.all([
    q<{ cur: boolean; n: number; avg: number | null; happy: number; unhappy: number; comments: number }>(sql`
      select created_at >= ${since(days)} as cur, count(*)::int as n, avg(rating)::float as avg,
             count(*) filter (where rating >= 4)::int as happy, count(*) filter (where rating <= 2)::int as unhappy,
             count(*) filter (where comment <> '')::int as comments
      from player_feedback where created_at >= ${since(2 * days)} group by 1`),
    q<{ rating: number; n: number }>(sql`select rating, count(*)::int as n from player_feedback where created_at >= ${since(days)} group by 1`),
    q<{ day: string; rating: number; n: number }>(sql`
      select to_char(created_at at time zone 'Asia/Colombo', 'YYYY-MM-DD') as day, rating, count(*)::int as n
      from player_feedback where created_at >= ${since(days)} group by 1, 2`),
    q<{ tag: string; n: number; low: number }>(sql`
      select t as tag, count(*)::int as n, count(*) filter (where rating <= 3)::int as low
      from player_feedback, unnest(tags) as t where created_at >= ${since(days)} group by 1 order by 2 desc`),
    q<{ quality: string; n: number; avg: number }>(sql`
      select coalesce(quality, 'unknown') as quality, count(*)::int as n, avg(rating)::float as avg
      from player_feedback where created_at >= ${since(days)} group by 1 order by 2 desc limit 6`),
    q<{ bucket: string; n: number; avg: number }>(sql`
      select case when stalls is null then 'unknown' when stalls = 0 then 'No buffering' when stalls <= 2 then '1-2 stalls' else '3+ stalls' end as bucket,
             count(*)::int as n, avg(rating)::float as avg
      from player_feedback where created_at >= ${since(days)} group by 1 order by 1`),
    q<{ media_key: string; title: string; n: number; avg: number; movie_id: string | null; show_id: string | null }>(sql`
      select f.media_key, max(f.title) as title, count(*)::int as n, avg(f.rating)::float as avg,
             max(f.movie_id::text) as movie_id, max(se.show_id::text) as show_id
      from player_feedback f
      left join episodes e on e.id = f.episode_id left join seasons se on se.id = e.season_id
      where f.created_at >= ${since(days)} group by f.media_key order by avg asc, n desc limit 8`),
    q<{ id: string; created_at: string; rating: number; title: string; tags: string[]; comment: string; quality: string | null; stalls: number | null; position_seconds: number | null; duration_seconds: number | null; trigger: string | null; user_id: string; email: string | null }>(sql`
      select f.id, f.created_at::text, f.rating, f.title, f.tags, f.comment, f.quality, f.stalls, f.position_seconds, f.duration_seconds, f.trigger, f.user_id, u.email
      from player_feedback f left join users u on u.id = f.user_id
      where ${listWhere} order by f.created_at desc limit ${PAGE_SIZE} offset ${(f.page - 1) * PAGE_SIZE}`),
    q<{ total: number }>(sql`select count(*)::int as total from player_feedback f where ${listWhere}`),
  ]);

  const k = (cur: boolean) => {
    const r = kpis.find((x) => x.cur === cur);
    return { n: r?.n ?? 0, avg: r?.avg ?? 0, happy: r?.happy ?? 0, unhappy: r?.unhappy ?? 0, comments: r?.comments ?? 0 };
  };
  // Zero-filled day axis, oldest first.
  const dayList: string[] = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(new Date(Date.now() - i * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" }));
  const perRating = (rating: number) => dayList.map((d) => daily.find((x) => x.day === d && x.rating === rating)?.n ?? 0);

  return {
    current: k(true),
    previous: k(false),
    distribution: [1, 2, 3, 4, 5].map((rating) => ({ rating, n: dist.find((d) => d.rating === rating)?.n ?? 0 })),
    days: dayList,
    perRating,
    tags,
    byQuality,
    byStalls,
    titles,
    list,
    total,
    pageSize: PAGE_SIZE,
  };
}
