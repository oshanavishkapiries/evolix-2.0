import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, Suspense } from "react";
import type { Breadcrumb, ErrorFrame } from "@/db/schema";
import { isUuid } from "@/lib/cms/api";
import { getEvent, getIssue } from "@/lib/errors/queries";
import { TZ } from "@/lib/tz";
import { AutoRefresh } from "../../_components/auto-refresh";
import { CopyIssue, IssueActions, StackTrace } from "../../_components/errors-ui";
import { StackChart } from "../../_components/stack-chart";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ event?: string }> };

const fmt = (d: Date | string) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: TZ });
const time = (t: number) => new Date(t).toLocaleTimeString("en-GB", { timeZone: TZ });

export default function IssuePage(props: Props) {
  return (
    <>
      <AutoRefresh seconds={30} />
      <Suspense fallback={<div className="skeleton mt-4 h-96" aria-busy="true" />}>
        <Issue {...props} />
      </Suspense>
    </>
  );
}

async function Issue({ params, searchParams }: Props) {
  const { id } = await params;
  const { event: eventId } = await searchParams;
  if (!isUuid(id)) notFound();
  const issue = await getIssue(id);
  if (!issue) notFound();
  const ev = await getEvent(id, eventId && isUuid(eventId) ? eventId : undefined);
  const e = ev?.event;
  const frames = (e?.frames ?? []) as ErrorFrame[];
  const crumbs = (e?.breadcrumbs ?? []) as Breadcrumb[];
  const ctx = (e?.context ?? {}) as Record<string, unknown>;
  const headers = (ctx.headers ?? {}) as Record<string, string>;
  const { headers: _h, componentStack, ...tags } = ctx;
  void _h;

  const appFrame = frames.find((f) => f.inApp) ?? frames[0];
  const markdown = [
    `## ${issue.type}: ${issue.message}`,
    "",
    `- Source: ${issue.source} (${issue.level}), ${issue.count} events, ${issue.users} users`,
    `- First seen ${fmt(issue.firstSeen)}, last seen ${fmt(issue.lastSeen)} (Sri Lanka time)`,
    issue.lastRelease && `- Release: ${issue.lastRelease}`,
    e?.url && `- URL: ${e.method ?? ""} ${e.url}`.replace("  ", " "),
    e?.route && `- Route: ${e.route}`,
    appFrame && `- Location: ${appFrame.file}:${appFrame.line} in ${appFrame.fn}`,
    "",
    appFrame?.context && ["```", ...appFrame.context.lines.map((l, i) => `${appFrame.context!.start + i === appFrame.line ? ">" : " "} ${appFrame.context!.start + i} | ${l}`), "```"].join("\n"),
    "",
    "### Stack",
    "```",
    frames.length ? frames.map((f) => `  at ${f.fn} (${f.file}:${f.line ?? "?"}:${f.col ?? "?"})${f.inApp ? "" : "  [lib]"}`).join("\n") : (e?.stack ?? ""),
    "```",
    crumbs.length ? ["", "### Breadcrumbs", ...crumbs.slice(-15).map((b) => `- ${time(b.t)} [${b.type}] ${b.message}`)].join("\n") : "",
    Object.keys(tags).length ? ["", "### Context", "```json", JSON.stringify(tags, null, 2), "```"].join("\n") : "",
  ]
    .filter((x): x is string => typeof x === "string")
    .join("\n");

  const eventHref = (eid: string | null) => (eid ? `/admin/errors/${id}?event=${eid}` : null);
  const nav = [
    ["Oldest", eventHref(ev?.oldestId && ev.oldestId !== e?.id ? ev.oldestId : null)],
    ["Older", eventHref(ev?.olderId ?? null)],
    ["Newer", eventHref(ev?.newerId ?? null)],
    ["Newest", eventId ? `/admin/errors/${id}` : null],
  ] as const;

  return (
    <div className="err-detail">
      <p className="text-sm">
        <Link href="/admin/errors">← Errors</Link>
      </p>
      <header className="err-head">
        <div className="min-w-0">
          <p className="err-meta">
            <span className={`err-src err-src-${issue.source}`}>{issue.source}</span>
            <span className={`err-level-tag err-level-${issue.level}`}>{issue.level}</span>
            <span className="err-status">{issue.status}</span>
          </p>
          <h1 className="err-h1">
            {issue.type}: <span>{issue.message}</span>
          </h1>
          {issue.culprit && <code className="err-culprit">{issue.culprit}</code>}
        </div>
        <div className="toolbar">
          <CopyIssue markdown={markdown} />
          <IssueActions id={issue.id} status={issue.status} />
        </div>
      </header>

      <div className="err-stats">
        <div className="stat"><span>Events</span><strong>{issue.count.toLocaleString()}</strong><small>{issue.storedEvents} kept with full detail</small></div>
        <div className="stat"><span>Users</span><strong>{issue.users}</strong><small>from kept events</small></div>
        <div className="stat"><span>First seen</span><strong className="err-date">{fmt(issue.firstSeen)}</strong><small>release {issue.firstRelease ?? "—"}</small></div>
        <div className="stat"><span>Last seen</span><strong className="err-date">{fmt(issue.lastSeen)}</strong><small>release {issue.lastRelease ?? "—"}</small></div>
      </div>

      <StackChart title="Events, last 30 days" days={issue.days.map((d) => d.day)} series={[{ key: "events", label: "", color: "#ff5a43", values: issue.days.map((d) => d.count) }]} />

      {ev && Object.keys(ev.tags).length > 0 && (
        <section className="err-tags">
          {Object.entries(ev.tags).map(([k, vals]) => {
            const sum = vals.reduce((a, v) => a + v.n, 0);
            return (
              <div key={k} className="stat">
                <span className="err-tag-k">{k}</span>
                <ul>
                  {vals.map((v) => (
                    <li key={v.value}>
                      <span className="err-tag-v" title={v.value}>{v.value}</span>
                      <span className="err-tag-bar"><span style={{ width: `${(v.n / sum) * 100}%` }} /></span>
                      <small>{Math.round((v.n / sum) * 100)}%</small>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      )}

      {!e ? (
        <div className="card text-sm">No stored events for this issue (older samples are pruned after 30 days).</div>
      ) : (
        <>
          <div className="err-event-bar">
            <span className="text-sm">
              Event <code>{e.id.slice(0, 8)}</code> at {fmt(e.createdAt)}
            </span>
            <span className="toolbar">
              {nav.map(([label, href]) => (href ? <Link key={label} href={href} className="btn-secondary rounded-md border px-3 py-1.5 text-sm no-underline">{label}</Link> : <span key={label} className="err-nav-off">{label}</span>))}
            </span>
          </div>

          <section>
            <h2>Stack trace</h2>
            <StackTrace frames={frames} raw={e.stack} />
          </section>

          {typeof componentStack === "string" && componentStack && (
            <details className="stat">
              <summary className="font-semibold">React component stack</summary>
              <pre className="err-raw">{componentStack.trim()}</pre>
            </details>
          )}

          <div className="err-grid">
            <section>
              <h2>Breadcrumbs</h2>
              {crumbs.length === 0 ? (
                <p className="text-sm">None recorded{issue.source === "server" ? " (server events carry request details instead)" : ""}.</p>
              ) : (
                <ol className="err-crumbs">
                  {crumbs.map((b, i) => (
                    <li key={i} data-level={b.level ?? "info"}>
                      <time>{time(b.t)}</time>
                      <span className="err-crumb-type">{b.type}</span>
                      <span className="err-crumb-msg">{b.message}</span>
                    </li>
                  ))}
                  <li data-level="error">
                    <time>{time(new Date(e.createdAt).getTime())}</time>
                    <span className="err-crumb-type">error</span>
                    <span className="err-crumb-msg">{issue.type}: {e.message}</span>
                  </li>
                </ol>
              )}
            </section>
            <section>
              <h2>Request and user</h2>
              <dl className="err-kv">
                {e.method || e.url ? <><dt>URL</dt><dd>{e.method} {e.url}</dd></> : null}
                {e.route && <><dt>Route</dt><dd><code>{e.route}</code></dd></>}
                <dt>User</dt>
                <dd>{e.userId ? <Link href={`/admin/users/${e.userId}`}>{e.userEmail ?? e.userId}</Link> : (e.userEmail ?? "Anonymous")}</dd>
                {e.userAgent && <><dt>User agent</dt><dd className="err-ua">{e.userAgent}</dd></>}
                <dt>Release</dt>
                <dd>{e.release ?? "—"} ({e.environment ?? "—"})</dd>
                {Object.entries(tags).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => (
                  <Fragment key={k}>
                    <dt>{k}</dt>
                    <dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                  </Fragment>
                ))}
                {Object.keys(headers).length > 0 && (
                  <>
                    <dt>Headers</dt>
                    <dd>
                      <pre className="err-raw">{Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n")}</pre>
                    </dd>
                  </>
                )}
              </dl>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
