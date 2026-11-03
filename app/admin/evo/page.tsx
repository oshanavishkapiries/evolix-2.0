import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { recentCachedSources } from "@/lib/cms/evo";
import { failureRate, shortEngine } from "@/lib/evo/admin-view";
import { engineGet, engines } from "@/lib/evo/client";
import type { EngineTask } from "@/lib/cms/evo";
import { allEngineTasks, engineCards, journeyReport } from "@/lib/evo/overview";
import { AutoRefresh } from "../_components/auto-refresh";
import { JourneysPanel } from "../_components/journeys-panel";
import { SourceDeleteButton, TaskActions } from "../_components/evo-controls";
import { PageHeader } from "../_components/page-header";
import { TZ } from "@/lib/tz";

const fmt = (d: Date | string) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });
const code = (s: number | null, e: number | null) => (s !== null && e !== null ? `S${s}E${e}` : "Movie");
async function failureSamples() {
  return Object.fromEntries(await Promise.all((await engines()).map(async (engine) => {
    const sample = await engineGet<EngineTask[]>("/tasks?limit=100", 4000, engine);
    return [engine.id, { rate: failureRate(sample ? sample.filter((t) => t.status === "FAILED" || t.cache_failed).length : null, sample?.length ?? 0), size: sample?.length ?? 0 }];
  })));
}

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
  const [cards, { tasks, unreachable }, cached, journeys, failures] = await Promise.all([engineCards(), allEngineTasks(), recentCachedSources(), journeyReport(24), failureSamples()]);
  const asOf = new Date().getTime();
  const multi = cards.length > 1;
  const nameOf = (id: string | null) => {
    const e = cards.find((x) => x.id === id);
    return e ? shortEngine(e.name, e.url).label : (id ?? "—");
  };

  return (
    <div className="evo-stack">
      <AutoRefresh seconds={20} />
      <JourneysPanel initial={journeys} multi={multi} engines={cards} failures={failures} asOf={asOf} />

      <section className="evo-section">
        <div className="evo-section-head">
          <div>
            <h2>Raw data</h2>
            <p className="evo-sub">For digging in. Most days the sections above are enough.</p>
          </div>
        </div>
        <details className="evo-details">
          <summary>Engine tries <span className="evo-count">{tasks.length}</span><span className="evo-muted"> · one row per try, newest first</span></summary>
          {unreachable.length > 0 && <p className="evo-note">Tries from {unreachable.join(", ")} are not shown while unreachable.</p>}
          {!tasks.length ? (
            <p className="evo-empty">No tries yet.</p>
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
