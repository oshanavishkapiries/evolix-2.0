import "server-only";
import { and, asc, desc, eq, gt, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { errorEvents, errorIssues } from "@/db/schema";
import { escapeLike } from "@/lib/cms/search";

export const ISSUE_STATUSES = ["unresolved", "resolved", "ignored"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const ISSUE_SORTS = { last: "Last seen", first: "First seen", count: "Events", users: "Users" } as const;
export type IssueSort = keyof typeof ISSUE_SORTS;

const SPARK_DAYS = 14;

/** Distinct users across an issue's stored events (events are sampled, so this is a lower bound). */
const usersOf = sql<number>`(select count(distinct coalesce(e.user_id::text, e.user_email)) from error_events e where e.issue_id = ${errorIssues.id})`.mapWith(Number);

export async function listIssues(o: { status?: IssueStatus | "all"; source?: string; q?: string; sort?: IssueSort; page: number; pageSize: number }) {
  const conds: SQL[] = [];
  if (o.status && o.status !== "all") conds.push(eq(errorIssues.status, o.status));
  if (o.source) conds.push(eq(errorIssues.source, o.source));
  if (o.q) {
    const t = `%${escapeLike(o.q)}%`;
    conds.push(or(ilike(errorIssues.message, t), ilike(errorIssues.type, t), ilike(errorIssues.culprit, t))!);
  }
  const where = conds.length ? and(...conds) : undefined;
  const order = { last: desc(errorIssues.lastSeen), first: desc(errorIssues.firstSeen), count: desc(errorIssues.count), users: desc(usersOf) }[o.sort ?? "last"];
  const [rows, [{ total }], counts] = await Promise.all([
    db
      .select({
        id: errorIssues.id,
        source: errorIssues.source,
        type: errorIssues.type,
        message: errorIssues.message,
        culprit: errorIssues.culprit,
        level: errorIssues.level,
        status: errorIssues.status,
        count: errorIssues.count,
        users: usersOf,
        firstSeen: errorIssues.firstSeen,
        lastSeen: errorIssues.lastSeen,
        lastRelease: errorIssues.lastRelease,
      })
      .from(errorIssues)
      .where(where)
      .orderBy(order, desc(errorIssues.lastSeen))
      .limit(o.pageSize)
      .offset((o.page - 1) * o.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(errorIssues).where(where),
    db.select({ status: errorIssues.status, n: sql<number>`count(*)::int` }).from(errorIssues).groupBy(errorIssues.status),
  ]);
  const spark = await sparklines(rows.map((r) => r.id));
  return {
    rows: rows.map((r) => ({ ...r, spark: spark.get(r.id) ?? [] })),
    total,
    counts: Object.fromEntries(ISSUE_STATUSES.map((s) => [s, counts.find((c) => c.status === s)?.n ?? 0])) as Record<IssueStatus, number>,
  };
}

/** Daily counts for the last `days` Sri Lanka days, oldest first, zero-filled. */
async function sparklines(ids: string[], days = SPARK_DAYS) {
  const out = new Map<string, number[]>();
  if (!ids.length) return out;
  const res = await db.execute(sql`
    select issue_id, (day - ((now() at time zone 'Asia/Colombo')::date - ${days - 1}::int))::int as i, count
    from error_issue_days
    where issue_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) and day > (now() at time zone 'Asia/Colombo')::date - ${days}::int`);
  for (const r of res.rows as { issue_id: string; i: number; count: number }[]) {
    const arr = out.get(r.issue_id) ?? Array<number>(days).fill(0);
    if (r.i >= 0 && r.i < days) arr[r.i] = r.count;
    out.set(r.issue_id, arr);
  }
  return out;
}

export async function getIssue(id: string) {
  const [issue] = await db.select({ ...getTableColumnsOfIssue(), users: usersOf }).from(errorIssues).where(eq(errorIssues.id, id)).limit(1);
  if (!issue) return null;
  const [days, stored] = await Promise.all([
    db.execute(sql`
      with d as (select generate_series((now() at time zone 'Asia/Colombo')::date - 29, (now() at time zone 'Asia/Colombo')::date, interval '1 day')::date as day)
      select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(x.count, 0)::int as count
      from d left join error_issue_days x on x.day = d.day and x.issue_id = ${id} order by d.day`),
    db.select({ n: sql<number>`count(*)::int` }).from(errorEvents).where(eq(errorEvents.issueId, id)),
  ]);
  return { ...issue, days: days.rows as { day: string; count: number }[], storedEvents: stored[0].n };
}

function getTableColumnsOfIssue() {
  const { id, source, type, message, culprit, level, status, count, firstSeen, lastSeen, resolvedAt, firstRelease, lastRelease } = errorIssues;
  return { id, source, type, message, culprit, level, status, count, firstSeen, lastSeen, resolvedAt, firstRelease, lastRelease };
}

/** One stored event (the newest when `eventId` is missing) with ids of its neighbours for paging. */
export async function getEvent(issueId: string, eventId?: string) {
  const base = eq(errorEvents.issueId, issueId);
  const [event] = eventId
    ? await db.select().from(errorEvents).where(and(base, eq(errorEvents.id, eventId))).limit(1)
    : await db.select().from(errorEvents).where(base).orderBy(desc(errorEvents.createdAt)).limit(1);
  if (!event) return null;
  const [[older], [newer], [oldest], tags] = await Promise.all([
    db.select({ id: errorEvents.id }).from(errorEvents).where(and(base, lt(errorEvents.createdAt, event.createdAt))).orderBy(desc(errorEvents.createdAt)).limit(1),
    db.select({ id: errorEvents.id }).from(errorEvents).where(and(base, gt(errorEvents.createdAt, event.createdAt))).orderBy(asc(errorEvents.createdAt)).limit(1),
    db.select({ id: errorEvents.id }).from(errorEvents).where(base).orderBy(asc(errorEvents.createdAt)).limit(1),
    tagSummary(issueId),
  ]);
  return { event, olderId: older?.id ?? null, newerId: newer?.id ?? null, oldestId: oldest?.id ?? null, tags };
}

/** Most common values across stored events: where it breaks, for whom, on what. */
async function tagSummary(issueId: string) {
  const res = await db.execute(sql`
    select k, v, count(*)::int as n from (
      select 'route' as k, coalesce(route, '-') as v from error_events where issue_id = ${issueId}
      union all select 'release', coalesce(release, '-') from error_events where issue_id = ${issueId}
      union all select 'browser', case when user_agent is null then '-' when user_agent ~* 'edg/' then 'Edge' when user_agent ~* 'firefox|fxios' then 'Firefox'
             when user_agent ~* 'samsungbrowser' then 'Samsung' when user_agent ~* 'chrome|crios' then 'Chrome' when user_agent ~* 'safari' then 'Safari' else 'Other' end
             from error_events where issue_id = ${issueId}
      union all select 'os', case when user_agent is null then '-' when user_agent ~* 'android' then 'Android' when user_agent ~* 'iphone|ipad' then 'iOS'
             when user_agent ~* 'windows' then 'Windows' when user_agent ~* 'mac os' then 'macOS' when user_agent ~* 'linux' then 'Linux' else 'Other' end
             from error_events where issue_id = ${issueId}
      union all select 'user', coalesce(user_email, 'anonymous') from error_events where issue_id = ${issueId}
    ) t group by k, v order by k, n desc`);
  const out: Record<string, { value: string; n: number }[]> = {};
  for (const r of res.rows as { k: string; v: string; n: number }[]) {
    const list = (out[r.k] ??= []);
    if (list.length < 5) list.push({ value: r.v, n: r.n });
  }
  return out;
}

export async function setIssueStatus(ids: string[], status: IssueStatus) {
  if (!ids.length) return 0;
  const rows = await db
    .update(errorIssues)
    .set({ status, resolvedAt: status === "resolved" ? new Date() : null })
    .where(sql`${errorIssues.id} in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`)
    .returning({ id: errorIssues.id });
  return rows.length;
}

export async function deleteIssues(ids: string[]) {
  if (!ids.length) return 0;
  const rows = await db
    .delete(errorIssues)
    .where(sql`${errorIssues.id} in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`)
    .returning({ id: errorIssues.id });
  return rows.length;
}

/** Overview card: open issues and how many are new or active in the last 24 hours. */
export async function errorSummary() {
  const res = await db.execute(sql`
    select count(*) filter (where status = 'unresolved')::int as open,
           count(*) filter (where status = 'unresolved' and first_seen > now() - interval '24 hours')::int as new24,
           count(*) filter (where status = 'unresolved' and last_seen > now() - interval '24 hours')::int as active24,
           coalesce((select sum(count) from error_issue_days where day >= (now() at time zone 'Asia/Colombo')::date - 1), 0)::int as events24
    from error_issues`);
  return res.rows[0] as { open: number; new24: number; active24: number; events24: number };
}
