import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Admin analytics over a rolling window of Sri Lanka (Asia/Colombo) days, read-only.
 * watch_progress keeps one row per user and title, so a "play" is a title someone watched (or resumed) in the window,
 * dated by its last update; earlier sessions on the same title are not counted separately.
 */
export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

type Rows<T> = Promise<T[]>;
const q = async <T>(query: ReturnType<typeof sql>): Rows<T> => (await db.execute(query)).rows as T[];

// One CTE shared by most queries: every touched progress row with its title, kind and window flag.
const plays = (days: number) => sql`
  with p as (
    select wp.user_id, wp.updated_at, wp.position_seconds, wp.duration_seconds, wp.completed,
           coalesce(wp.movie_id, s.id) as title_id,
           case when wp.movie_id is not null then 'movie' else 'show' end as kind,
           (wp.updated_at >= date_trunc('day', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo' - make_interval(days => ${days - 1})) as cur
    from watch_progress wp
    left join episodes e on e.id = wp.episode_id
    left join seasons se on se.id = e.season_id
    left join shows s on s.id = se.show_id
    where wp.updated_at >= date_trunc('day', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo' - make_interval(days => ${2 * days - 1})
  )`;

const since = (days: number) => sql`date_trunc('day', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo' - make_interval(days => ${days - 1})`;

export type Kpis = { plays: number; viewers: number; hours: number; completed: number; signups: number; bookmarks: number };

export async function analytics(days: Range) {
  const [kpiRows, signupRows, bookmarkRows, daily, heat, top, genres, funnel, devices, viewers, coverage, reports] = await Promise.all([
    q<{ cur: boolean; plays: number; viewers: number; seconds: number; completed: number }>(sql`${plays(days)}
      select cur, count(*)::int as plays, count(distinct user_id)::int as viewers,
             coalesce(sum(position_seconds), 0)::float as seconds, count(*) filter (where completed)::int as completed
      from p group by cur`),
    q<{ cur: boolean; n: number }>(sql`
      select created_at >= ${since(days)} as cur, count(*)::int as n from users
      where created_at >= ${since(2 * days)} group by 1`),
    q<{ cur: boolean; n: number }>(sql`
      select created_at >= ${since(days)} as cur, count(*)::int as n from bookmarks
      where created_at >= ${since(2 * days)} group by 1`),
    q<{ day: string; movies: number; episodes: number; viewers: number; seconds: number; signups: number }>(sql`
      with d as (select generate_series(${since(days)}, date_trunc('day', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo', interval '1 day') as day),
      w as (
        select date_trunc('day', updated_at at time zone 'Asia/Colombo') at time zone 'Asia/Colombo' as day,
               count(*) filter (where movie_id is not null)::int as movies,
               count(*) filter (where episode_id is not null)::int as episodes,
               count(distinct user_id)::int as viewers, coalesce(sum(position_seconds), 0)::float as seconds
        from watch_progress where updated_at >= ${since(days)} group by 1),
      u as (select date_trunc('day', created_at at time zone 'Asia/Colombo') at time zone 'Asia/Colombo' as day, count(*)::int as n from users where created_at >= ${since(days)} group by 1)
      select to_char(d.day at time zone 'Asia/Colombo', 'YYYY-MM-DD') as day,
             coalesce(w.movies, 0) as movies, coalesce(w.episodes, 0) as episodes, coalesce(w.viewers, 0) as viewers,
             coalesce(w.seconds, 0) as seconds, coalesce(u.n, 0) as signups
      from d left join w on w.day = d.day left join u on u.day = d.day order by d.day`),
    q<{ dow: number; hour: number; n: number }>(sql`
      select extract(isodow from updated_at at time zone 'Asia/Colombo')::int as dow, extract(hour from updated_at at time zone 'Asia/Colombo')::int as hour, count(*)::int as n
      from watch_progress where updated_at >= ${since(days)} group by 1, 2`),
    q<{ id: string; kind: "movie" | "show"; title: string; poster: string | null; plays: number; viewers: number; seconds: number; completed: number }>(sql`${plays(days)}
      select p.title_id as id, p.kind, coalesce(m.title, s.name) as title, coalesce(m.poster_path, s.poster_path) as poster,
             count(*)::int as plays, count(distinct p.user_id)::int as viewers,
             coalesce(sum(p.position_seconds), 0)::float as seconds, count(*) filter (where p.completed)::int as completed
      from p left join movies m on m.id = p.title_id left join shows s on s.id = p.title_id
      where p.cur group by 1, 2, 3, 4 order by viewers desc, plays desc, seconds desc limit 10`),
    q<{ genre: string; plays: number }>(sql`${plays(days)}
      select g as genre, count(*)::int as plays
      from p left join movies m on m.id = p.title_id left join shows s on s.id = p.title_id,
           unnest(coalesce(m.genres, s.genres)) as g
      where p.cur group by 1 order by 2 desc limit 8`),
    q<{ total: number; verified: number; approved: number; watched: number; active: number }>(sql`
      select count(*)::int as total, count(email_verified_at)::int as verified, count(approved_at)::int as approved,
             (select count(distinct user_id)::int from watch_progress) as watched,
             (select count(distinct user_id)::int from watch_progress where updated_at >= ${since(days)}) as active
      from users`),
    q<{ device: string; os: string; browser: string; n: number }>(sql`
      select case when user_agent ~* 'ipad|tablet' or (user_agent ~* 'android' and user_agent !~* 'mobile') then 'Tablet'
                  when user_agent ~* 'mobile|iphone|ipod' then 'Mobile' else 'Desktop' end as device,
             case when user_agent ~* 'android' then 'Android' when user_agent ~* 'iphone|ipad|ipod' then 'iOS'
                  when user_agent ~* 'windows' then 'Windows' when user_agent ~* 'mac os' then 'macOS'
                  when user_agent ~* 'linux|x11' then 'Linux' else 'Other' end as os,
             case when user_agent ~* 'edg/' then 'Edge' when user_agent ~* 'opr/|opera' then 'Opera'
                  when user_agent ~* 'samsungbrowser' then 'Samsung' when user_agent ~* 'firefox|fxios' then 'Firefox'
                  when user_agent ~* 'chrome|crios' then 'Chrome' when user_agent ~* 'safari' then 'Safari' else 'Other' end as browser,
             count(distinct user_id)::int as n
      from sessions where created_at >= ${since(days)} and user_agent is not null group by 1, 2, 3`),
    q<{ email: string; plays: number; seconds: number; last: string }>(sql`
      select u.email, count(*)::int as plays, coalesce(sum(wp.position_seconds), 0)::float as seconds, max(wp.updated_at)::text as last
      from watch_progress wp join users u on u.id = wp.user_id
      where wp.updated_at >= ${since(days)} group by u.email order by seconds desc limit 8`),
    q<{ kind: "movie" | "show"; published: number; watched: number }>(sql`
      select 'movie' as kind, count(*)::int as published,
             count(*) filter (where exists (select 1 from watch_progress wp where wp.movie_id = m.id))::int as watched
      from movies m where m.is_published
      union all
      select 'show', count(*)::int,
             count(*) filter (where exists (select 1 from watch_progress wp join episodes e on e.id = wp.episode_id join seasons se on se.id = e.season_id where se.show_id = s.id))::int
      from shows s where s.is_published`),
    q<{ status: string; n: number }>(sql`select status::text as status, count(*)::int as n from reports group by 1`),
  ]);

  const kpi = (cur: boolean): Kpis => {
    const k = kpiRows.find((r) => r.cur === cur);
    return {
      plays: k?.plays ?? 0,
      viewers: k?.viewers ?? 0,
      hours: (k?.seconds ?? 0) / 3600,
      completed: k?.completed ?? 0,
      signups: signupRows.find((r) => r.cur === cur)?.n ?? 0,
      bookmarks: bookmarkRows.find((r) => r.cur === cur)?.n ?? 0,
    };
  };

  const tally = (key: "device" | "os" | "browser") => {
    const m = new Map<string, number>();
    for (const r of devices) m.set(r[key], (m.get(r[key]) ?? 0) + r.n);
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };

  return {
    days,
    current: kpi(true),
    previous: kpi(false),
    daily,
    heat,
    top,
    genres,
    funnel: funnel[0],
    devices: { device: tally("device"), os: tally("os"), browser: tally("browser") },
    viewers,
    coverage,
    reports,
  };
}

export type Analytics = Awaited<ReturnType<typeof analytics>>;
