import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { engineOverview } from "@/lib/cms/evo";
import { engineById } from "@/lib/evo/client";
import { combinedSummary, enginesOverview } from "@/lib/evo/overview";
import { DrainButton, MetricsPanel, ProvidersPanel } from "../../../_components/engine-panels";
import { Breadcrumbs } from "../../../_components/breadcrumbs";
import { EvoControls, TaskActions } from "../../../_components/evo-controls";
import { PageHeader } from "../../../_components/page-header";
import { SummaryFlow } from "../../../_components/pipeline-graph";

const fmt = (d: Date | string) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
const code = (s: number | null, e: number | null) => (s !== null && e !== null ? `S${s}E${e}` : "Movie");

type Props = { params: Promise<{ id: string }> };

export default function EnginePage({ params }: Props) {
  return (
    <Suspense fallback={<div className="skeleton mt-4 h-64" aria-busy="true" />}>
      <Engine params={params} />
    </Suspense>
  );
}

async function Engine({ params }: Props) {
  await connection(); // live engine calls: never at build time
  const { id } = await params;
  const ref = engineById(id);
  if (!ref) notFound();
  const [all, { online, tasks, error }, summary] = await Promise.all([enginesOverview(), engineOverview(40, ref), combinedSummary(ref)]);
  const e = all.find((x) => x.id === id);
  if (!e) notFound();
  const multi = all.length > 1;

  return (
    <>
      <Breadcrumbs items={[{ label: "Evo pipeline", href: "/admin/evo" }, { label: e.name }]} />
      <PageHeader
        title={e.name}
        actions={
          <>
            {multi && <DrainButton id={e.id} draining={e.draining} />}
            <Link href={`/admin/cdn?engine=${encodeURIComponent(e.id)}`} className="btn-link rounded-md border px-3 py-1.5 text-sm">CDN files</Link>
          </>
        }
      />
      <p className="mt-2 text-sm">
        <strong>{e.available ? (e.draining ? "Draining" : "Available") : "Unavailable"}</strong>
        {e.draining && (e.safeToRemove ? " · safe to remove from EVO_ENGINES" : e.available ? " · finishing its jobs, takes no new ones" : " · cannot confirm it is empty while unreachable")}
        {" · "}{e.url}
      </p>
      <dl className="mt-3 flex flex-wrap gap-6" aria-label="Engine status">
        <div><dt className="text-xs">Last good health check</dt><dd className="font-semibold">{e.lastOkAt ? fmt(e.lastOkAt) : "never"}</dd></div>
        <div><dt className="text-xs">Active jobs{!e.available && " (last known)"}</dt><dd className="font-semibold">{e.activeJobs}</dd></div>
        <div><dt className="text-xs">Queue depth{!e.available && " (last known)"}</dt><dd className="font-semibold">{e.queueDepth}</dd></div>
        <div><dt className="text-xs">Free disk</dt><dd className="font-semibold">{e.freeDiskGb != null ? `${Math.round(e.freeDiskGb)} GB` : "—"}</dd></div>
        <div><dt className="text-xs">Recent failures</dt><dd className="font-semibold">{e.failures ?? "—"}</dd></div>
      </dl>
      {!e.available && e.lastError && <p className="mt-2 text-sm">Last error: {e.lastError}</p>}

      {online ? (
        <>
          <EvoControls engine={e.id} />

          <h2 className="mt-6">Stream providers</h2>
          <ProvidersPanel engine={e.id} />

          <h2 className="mt-6">Extraction metrics (last 24 hours)</h2>
          <MetricsPanel engine={e.id} />

          <h2 className="mt-6">Pipeline</h2>
          <div className="mt-2">
            <SummaryFlow initial={summary} engine={e.id} />
          </div>

          <h2 className="mt-6">Tasks on this engine</h2>
          {!tasks.length ? (
            <p className="mt-2 text-sm">No tasks yet.</p>
          ) : (
            <div className="table-wrap mt-2">
              <table className="data-table">
                <thead>
                  <tr><th>Title</th><th>Quality</th><th>Status</th><th>Message</th><th>Updated</th><th /></tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.task_id}>
                      <td>
                        <Link href={`/admin/evo/${t.task_id}`}>{t.title ?? `TMDB ${t.tmdb_id}`}</Link>
                        <div className="text-xs">{code(t.season, t.episode)}</div>
                      </td>
                      <td>{t.requested_quality === "sub:si" ? "Sinhala subtitles" : (t.resolved_quality ?? t.requested_quality)}</td>
                      <td>{t.cache_failed ? `${t.status} (cache failed)` : t.status}</td>
                      <td style={{ maxWidth: "24rem", overflowWrap: "anywhere" }}>{t.message}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmt(t.updated_at)}</td>
                      <td><TaskActions id={t.task_id} status={t.status} cacheFailed={t.cache_failed} canMove={multi && t.requested_quality !== "sub:si"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <p className="mt-4 text-sm">This engine is unreachable{error ? ` (${error})` : ""}, so its tasks, settings and queue controls are unavailable. The numbers above are the last ones it reported.</p>
      )}
    </>
  );
}
