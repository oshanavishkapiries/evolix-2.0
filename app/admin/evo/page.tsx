import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { recentCachedSources } from "@/lib/cms/evo";
import { attentionItems, healthLine, shortEngine } from "@/lib/evo/admin-view";
import { NODES } from "@/lib/evo/flow";
import { allEngineTasks, engineCards, journeyReport } from "@/lib/evo/overview";
import { AutoRefresh } from "../_components/auto-refresh";
import { AttentionList, EngineCards, StatusPill } from "../_components/evo-overview";
import { JourneysPanel } from "../_components/journeys-panel";
import { SourceDeleteButton, TaskActions } from "../_components/evo-controls";
import { PageHeader } from "../_components/page-header";
import { TZ } from "@/lib/tz";

const fmt = (d: Date | string) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });
const code = (s: number | null, e: number | null) => (s !== null && e !== null ? `S${s}E${e}` : "Movie");
const stepLabel = (id: string | null) => (id ? (NODES.find((n) => n.id === id)?.label ?? id) : "");

export default function EvoPage() {
  return (
    <>
      <PageHeader
        title="Evo pipeline"
        actions={<Link href="/admin/cdn" className="btn-link rounded-md border px-3 py-1.5 text-sm">CDN files</Link>}
      />
      <Suspense fallback={<div className="skeleton mt-4 h-32" aria-busy="true" />}>
        <EvoOverview />
      </Suspense>
    </>
  );
}

async function EvoOverview() {
  await connection(); // live engine calls: never at build time
  const [cards, { tasks, unreachable }, cached, journeys] = await Promise.all([engineCards(), allEngineTasks(), recentCachedSources(), journeyReport(24)]);
  const multi = cards.length > 1;
  const nameOf = (id: string | null) => {
    const e = cards.find((x) => x.id === id);
    return e ? shortEngine(e.name, e.url).label : (id ?? "—");
  };
  const stuck = journeys.journeys
    .filter((j) => j.outcome === "never")
    .slice(0, 5)
    .map((j) => ({
      id: j.id,
      title: `${j.title ?? `TMDB ${j.tmdbId}`}${j.mediaType === "tv" && j.season !== null ? ` S${j.season}E${j.episode}` : ""}${j.kind === "sinhala" ? " (Sinhala)" : ""}`,
      detail: j.trouble ? `${stepLabel(j.trouble.step)}${j.trouble.step ? ": " : ""}${j.trouble.detail}`.slice(0, 140) : "",
      href: `/admin/evo/${j.decisive.task_id}`,
    }));
  const attention = attentionItems(cards, stuck);
  const health = healthLine(cards);
  const up = cards.filter((e) => e.available).length;
  const sum = (f: (e: (typeof cards)[number]) => number) => cards.reduce((n, e) => n + f(e), 0);
  const providers = cards.flatMap((e) => e.providers ?? []);

  return (
    <div className="evo-stack">
      <AutoRefresh seconds={20} />
      <div className="health" data-tone={health.level}>
        <StatusPill tone={health.level} text={health.text} />
        <ul>
          <li><strong>{up}/{cards.length}</strong> engines up</li>
          <li><strong>{sum((e) => e.queue?.extracting ?? e.activeJobs)}</strong> extracting</li>
          <li><strong>{sum((e) => e.queue?.caching ?? 0)}</strong> caching</li>
          <li><strong>{sum((e) => e.queue?.waiting_extraction ?? e.queueDepth)}</strong> waiting</li>
          <li><strong>{providers.filter((p) => p.state === "healthy").length}/{providers.length}</strong> providers healthy</li>
        </ul>
      </div>

      <section className="evo-section">
        <div className="evo-section-head"><h2>Needs attention {attention.length > 0 && <span className="evo-count" data-tone="bad">{attention.length}</span>}</h2></div>
        <AttentionList items={attention} />
      </section>

      <section className="evo-section">
        <div className="evo-section-head"><h2>Engines</h2></div>
        <EngineCards engines={cards} />
      </section>

      <JourneysPanel initial={journeys} multi={multi} />

      <section className="evo-section">
        <div className="evo-section-head">
          <div>
            <h2>Raw data</h2>
            <p className="evo-sub">For digging in. Most days the sections above are enough.</p>
          </div>
        </div>
        <details className="evo-details">
          <summary>Engine tasks <span className="evo-count">{tasks.length}</span><span className="evo-muted"> · one row per try, newest first</span></summary>
          {unreachable.length > 0 && <p className="evo-note">Tasks of {unreachable.join(", ")} are not shown while it is unreachable.</p>}
          {!tasks.length ? (
            <p className="evo-empty">No tasks yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table evo-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    {multi && <th>Engine</th>}
                    <th>Quality</th>
                    <th>Status</th>
                    <th>Message</th>
                    <th>Updated</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.task_id}>
                      <td>
                        <Link href={`/admin/evo/${t.task_id}`} className="evo-title">{t.title ?? `TMDB ${t.tmdb_id}`}</Link>
                        <div className="evo-muted">{code(t.season, t.episode)}</div>
                      </td>
                      {multi && <td>{nameOf(t.engineId)}</td>}
                      <td>{t.requested_quality.startsWith("sub:si") ? "Sinhala subtitles" : (t.resolved_quality ?? t.requested_quality)}</td>
                      <td><span className="tag" data-status={t.cache_failed ? "FAILED" : t.status}>{t.cache_failed ? `${t.status.toLowerCase()} · cache failed` : t.status.toLowerCase()}</span></td>
                      <td className="evo-why">{t.message}</td>
                      <td className="nowrap evo-muted">{fmt(t.updated_at)}</td>
                      <td><TaskActions id={t.task_id} status={t.status} cacheFailed={t.cache_failed} canMove={multi && !t.requested_quality.startsWith("sub:si")} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
        <details className="evo-details">
          <summary>Cached sources <span className="evo-count">{cached.length}</span><span className="evo-muted"> · newest videos on the CDN</span></summary>
          {!cached.length ? (
            <p className="evo-empty">Nothing cached yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table evo-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Quality</th>
                    {multi && <th>Engine</th>}
                    <th>State</th>
                    <th>Cached</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {cached.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/admin/${s.kind === "movie" ? "movies" : "shows"}/${s.titleId}`} className="evo-title">{s.title}</Link>
                        <div className="evo-muted">{s.context}</div>
                      </td>
                      <td>{s.quality ?? "—"}</td>
                      {multi && <td>{nameOf(s.engineId)}</td>}
                      <td><span className="tag" data-status={s.isActive ? "COMPLETED" : "FAILED"}>{s.isActive ? "active" : "file gone"}</span></td>
                      <td className="nowrap evo-muted">{fmt(s.createdAt)}</td>
                      <td>
                        <SourceDeleteButton sourceId={s.id} label={`${s.title} ${s.context} ${s.quality ?? ""}`.trim()} engine={cards.some((e) => e.id === s.engineId) ? (s.engineId ?? undefined) : undefined} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </section>
    </div>
  );
}
