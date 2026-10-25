import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { recentCachedSources } from "@/lib/cms/evo";
import { allEngineTasks, combinedSummary, enginesOverview } from "@/lib/evo/overview";
import { SummaryFlow } from "../_components/pipeline-graph";
import { SourceDeleteButton, TaskActions } from "../_components/evo-controls";
import { PageHeader } from "../_components/page-header";

const fmt = (d: Date | string) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
const code = (s: number | null, e: number | null) => (s !== null && e !== null ? `S${s}E${e}` : "Movie");

export default function EvoPage() {
  return (
    <>
      <PageHeader
        title="Evo pipeline"
        actions={
          <>
            <Link href="/admin/evo/settings" className="btn-link rounded-md border px-3 py-1.5 text-sm">Pipeline control</Link>
            <Link href="/admin/evo/cdn" className="btn-link rounded-md border px-3 py-1.5 text-sm">CDN files</Link>
          </>
        }
      />
      <Suspense fallback={<div className="skeleton mt-4 h-32" aria-busy="true" />}>
        <EvoOverview />
      </Suspense>
    </>
  );
}

async function EvoOverview() {
  await connection(); // live engine calls: never at build time
  const [engineList, { tasks, unreachable }, cached, summary] = await Promise.all([enginesOverview(), allEngineTasks(), recentCachedSources(), combinedSummary()]);
  const failed = tasks.filter((t) => t.status === "FAILED" || t.cache_failed);
  const multi = engineList.length > 1;
  const nameOf = (id: string | null) => engineList.find((e) => e.id === id)?.name ?? id ?? "—";

  return (
    <>
      <h2 className="mt-4">Engines</h2>
      <div className="table-wrap mt-2">
        <table className="data-table">
          <thead>
            <tr>
              <th>Engine</th>
              <th>State</th>
              <th>Last good check</th>
              <th>Active jobs</th>
              <th>Queue</th>
              <th>Free disk</th>
              <th>Recent failures</th>
            </tr>
          </thead>
          <tbody>
            {engineList.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/admin/evo/engines/${encodeURIComponent(e.id)}`}>{e.name}</Link>
                  <div className="text-xs">{e.url}</div>
                </td>
                <td>
                  <strong>{e.available ? (e.draining ? "Draining" : "Available") : "Unavailable"}</strong>
                  {e.draining && (e.safeToRemove ? " · safe to remove" : e.available ? " · finishing jobs" : "")}
                  {!e.available && e.lastError && <div className="text-xs">{e.lastError}</div>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{e.lastOkAt ? fmt(e.lastOkAt) : "never"}</td>
                <td>{e.activeJobs}{!e.available && " (last known)"}</td>
                <td>{e.queueDepth}{!e.available && " (last known)"}</td>
                <td>{e.freeDiskGb != null ? `${Math.round(e.freeDiskGb)} GB` : "—"}</td>
                <td>{e.failures ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unreachable.length > 0 && <p className="mt-2 text-sm">Tasks of {unreachable.join(", ")} are not shown while it is unreachable.</p>}
      {failed.length > 0 && (
        <p className="mt-2 text-sm">
          {failed.length} recent task(s) failed or were not cached. Viewing the title again (or requesting the quality) retries them.
        </p>
      )}

      <h2 className="mt-6">Pipeline</h2>
      <div className="mt-2">
        <SummaryFlow initial={summary} engine="all" />
      </div>

      <h2 className="mt-6">Engine tasks</h2>
      {!tasks.length ? (
        <p className="mt-2 text-sm">No tasks yet.</p>
      ) : (
        <div className="table-wrap mt-2">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                {multi && <th>Engine</th>}
                <th>Quality</th>
                <th>Status</th>
                <th>Message</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.task_id}>
                  <td>
                    <Link href={`/admin/evo/${t.task_id}`}>{t.title ?? `TMDB ${t.tmdb_id}`}</Link>
                    <div className="text-xs">{code(t.season, t.episode)}</div>
                  </td>
                  {multi && <td>{t.engineName}</td>}
                  <td>{t.requested_quality === "sub:si" ? "Sinhala subtitles" : (t.resolved_quality ?? t.requested_quality)}</td>
                  <td>{t.cache_failed ? `${t.status} (cache failed)` : t.status}</td>
                  <td style={{ maxWidth: "24rem", overflowWrap: "anywhere" }}>{t.message}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmt(t.updated_at)}</td>
                  <td>
                    <TaskActions id={t.task_id} status={t.status} cacheFailed={t.cache_failed} canMove={multi && t.requested_quality !== "sub:si"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-6">Cached sources</h2>
      {!cached.length ? (
        <p className="mt-2 text-sm">Nothing cached yet.</p>
      ) : (
        <div className="table-wrap mt-2">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Quality</th>
                {multi && <th>Engine</th>}
                <th>State</th>
                <th>Cached</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cached.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/admin/${s.kind === "movie" ? "movies" : "shows"}/${s.titleId}`}>{s.title}</Link>
                    <div className="text-xs">{s.context}</div>
                  </td>
                  <td>{s.quality ?? "—"}</td>
                  {multi && <td>{nameOf(s.engineId)}</td>}
                  <td>{s.isActive ? "active" : "disabled (file gone)"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmt(s.createdAt)}</td>
                  <td>
                    <SourceDeleteButton sourceId={s.id} label={`${s.title} ${s.context} ${s.quality ?? ""}`.trim()} engine={engineList.some((e) => e.id === s.engineId) ? (s.engineId ?? undefined) : undefined} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
