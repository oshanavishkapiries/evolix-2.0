import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { Breadcrumb, ErrorFrame } from "@/db/schema";
import { sendAlert } from "./alert";
import { scrubText } from "./scrub";
import { culpritFrame, frameLabel } from "./stack";

const KEEP_EVENTS = 100;
const EVENTS_PER_MINUTE = 10;
const ALERT_EVERY_MS = 60 * 60 * 1000;

export type ErrorInput = {
  source: "server" | "client" | "engine";
  type: string;
  message: string;
  stack?: string;
  frames: ErrorFrame[];
  level?: "error" | "warning" | "fatal";
  url?: string | null;
  method?: string | null;
  route?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  userAgent?: string | null;
  breadcrumbs?: Breadcrumb[];
  context?: Record<string, unknown>;
  /** Overrides the computed grouping key. */
  fingerprint?: string;
};

const RELEASE = process.env.NEXT_PUBLIC_RELEASE || null;
const ENVIRONMENT = process.env.NODE_ENV ?? "development";

/** Numbers, ids, hashes and quoted values vary between occurrences of the same bug; strip them before grouping. */
function normalizeMessage(m: string) {
  return m
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/(["'`]).{0,200}?\1/g, "<str>")
    .replace(/\d+/g, "<n>")
    .slice(0, 300);
}

function fingerprintOf(e: Pick<ErrorInput, "source" | "type" | "message" | "frames" | "route">) {
  const top = culpritFrame(e.frames);
  // Without an in-app frame, the route keeps unrelated framework errors apart.
  const where = top?.inApp ? `${top.file}:${top.fn}` : `${top?.file ?? ""}|${e.route ?? ""}`;
  return createHash("sha1").update([e.source, e.type, normalizeMessage(e.message), where].join("\n")).digest("hex");
}

// Per-issue sampling: count every occurrence, store at most EVENTS_PER_MINUTE full events per issue per minute.
const windows = new Map<string, { at: number; n: number }>();
function sampled(fp: string) {
  const now = Date.now();
  const w = windows.get(fp);
  if (!w || now - w.at > 60_000) {
    windows.set(fp, { at: now, n: 1 });
    if (windows.size > 2000) windows.delete(windows.keys().next().value!);
    return true;
  }
  return ++w.n <= EVENTS_PER_MINUTE;
}

/** Groups the event into an issue, records it, prunes old samples and alerts on new issues and regressions. */
export async function recordError(input: ErrorInput) {
  const message = scrubText(input.message || "(no message)").slice(0, 2000);
  const type = (input.type || "Error").slice(0, 120);
  const frames = input.frames.slice(0, 60);
  const fp = input.fingerprint ?? fingerprintOf({ ...input, message, type, frames });
  const top = culpritFrame(frames);
  const culprit = (top?.inApp ? frameLabel(top) : input.route || frameLabel(top)).slice(0, 300);

  const res = await db.execute(sql`
    with prev as (select status from error_issues where fingerprint = ${fp})
    insert into error_issues (fingerprint, source, type, message, culprit, level, count, first_release, last_release)
    values (${fp}, ${input.source}, ${type}, ${message}, ${culprit}, ${input.level ?? "error"}, 1, ${RELEASE}, ${RELEASE})
    on conflict (fingerprint) do update set
      count = error_issues.count + 1,
      last_seen = now(),
      message = excluded.message,
      culprit = excluded.culprit,
      last_release = excluded.last_release,
      status = case when error_issues.status = 'resolved' then 'unresolved'::error_status else error_issues.status end,
      resolved_at = case when error_issues.status = 'resolved' then null else error_issues.resolved_at end
    returning id, status::text as status, count, alerted_at, (select status::text from prev) as prev_status`);
  const issue = res.rows[0] as { id: string; status: string; count: number; alerted_at: string | null; prev_status: string | null };

  const jobs: Promise<unknown>[] = [
    db.execute(sql`
      insert into error_issue_days (issue_id, day, count) values (${issue.id}, (now() at time zone 'Asia/Colombo')::date, 1)
      on conflict (issue_id, day) do update set count = error_issue_days.count + 1`),
  ];

  if (sampled(fp)) {
    jobs.push(
      db.execute(sql`
        insert into error_events (issue_id, message, stack, frames, url, method, route, user_id, user_email, user_agent, release, environment, breadcrumbs, context)
        values (${issue.id}, ${message}, ${scrubText(input.stack ?? "").slice(0, 20_000)}, ${JSON.stringify(frames)}::jsonb,
                ${input.url ? scrubText(input.url).slice(0, 2000) : null}, ${input.method ?? null}, ${input.route ?? null},
                ${input.userId ?? null}, ${input.userEmail ?? null}, ${input.userAgent?.slice(0, 500) ?? null}, ${RELEASE}, ${ENVIRONMENT},
                ${JSON.stringify((input.breadcrumbs ?? []).slice(-40).map((b) => ({ ...b, message: scrubText(String(b.message)).slice(0, 500) })))}::jsonb,
                ${JSON.stringify(input.context ?? {})}::jsonb)`),
    );
  }
  await Promise.all(jobs);

  // Keep the newest KEEP_EVENTS samples per issue, and nothing older than 30 days overall.
  if (issue.count % 25 === 0) {
    await db.execute(sql`
      delete from error_events where issue_id = ${issue.id} and id not in (
        select id from error_events where issue_id = ${issue.id} order by created_at desc limit ${KEEP_EVENTS})`);
  }
  if (Math.random() < 0.01) {
    await db.execute(sql`delete from error_events where created_at < now() - interval '30 days'`);
    await db.execute(sql`delete from error_issue_days where day < (now() at time zone 'Asia/Colombo')::date - 120`);
  }

  const kind = issue.prev_status === null ? "new" : issue.prev_status === "resolved" ? "regression" : null;
  const quiet = issue.alerted_at && Date.now() - new Date(issue.alerted_at).getTime() < ALERT_EVERY_MS;
  if (kind && issue.status !== "ignored" && !quiet) {
    await db.execute(sql`update error_issues set alerted_at = now() where id = ${issue.id}`);
    await sendAlert({ id: issue.id, kind, source: input.source, type, message, culprit, url: input.url, release: RELEASE });
  }
  return issue.id;
}
