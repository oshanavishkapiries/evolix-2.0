import { EngineConfigSyncChip } from "../../../_components/engine-config-panel";
import Link from "next/link";
import { EngineRegistryActions } from "../_components/registry-controls";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { engineOverview } from "@/lib/cms/evo";
import { engineState, shortEngine } from "@/lib/evo/admin-view";
import { engineById } from "@/lib/evo/client";
import { combinedSummary, enginesOverview } from "@/lib/evo/overview";
import { DrainButton, MetricsPanel, ProvidersPanel } from "../../../_components/engine-panels";
import { Breadcrumbs } from "../../../_components/breadcrumbs";
import { CopyText } from "../../../_components/copy-text";
import { EngineActions, EngineSettings, QueueStats, TaskActions } from "../../../_components/evo-controls";
import { StatusPill } from "../../../_components/evo-overview";
import { SummaryFlow } from "../../../_components/pipeline-graph";
import { TZ } from "@/lib/tz";

const fmt = (d: Date | string) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });
const code = (s: number | null, e: number | null) => (s !== null && e !== null ? `S${s}E${e}` : "Movie");

const TABS = [
  { id: "status", label: "Status" },
  { id: "tasks", label: "Tasks" },
  { id: "settings", label: "Settings" },
] as const;
type TabId = (typeof TABS)[number]["id"];

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> };

export default function EnginePage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<div className="skeleton mt-4 h-64" aria-busy="true" />}>
      <Engine params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Engine({ params, searchParams }: Props) {
  await connection(); // live engine calls: never at build time
  const [{ id }, { tab: asked }] = await Promise.all([params, searchParams]);
  const ref = (await engineById(id));
  if (!ref) notFound();
  const tab: TabId = TABS.some((t) => t.id === asked) ? (asked as TabId) : "status";
  const [all, { online, tasks, error }, summary] = await Promise.all([enginesOverview(), engineOverview(40, ref), tab === "status" ? combinedSummary(ref) : null]);
  const e = all.find((x) => x.id === id);
  if (!e) notFound();
  const multi = all.length > 1;
  const { label, host } = shortEngine(e.name, e.url);
  const st = engineState({ available: e.available, draining: e.draining, queue: null });
  const base = `/admin/evo/engines/${encodeURIComponent(e.id)}`;

  return (
    <>
      <Breadcrumbs items={[{ label: "Evo pipeline", href: "/admin/evo" }, { label }]} />
      <div className="page-header engine-head">
        <div>
          <h1>{label} <StatusPill {...st} /></h1>
          <p className="engine-sub">
            <span>{host}</span>
            <CopyText text={e.url} label="Copy engine URL" />
            {e.draining && <span className="warn-text">{e.safeToRemove ? "Empty: safe to remove using Manage engine" : e.available ? "Finishing its jobs, takes no new ones" : "Cannot confirm it is empty while unreachable"}</span>}
          </p>
        </div>
        <div className="toolbar">
          {online ? (
            <EngineActions engine={e.id}><DrainButton id={e.id} draining={e.draining} /></EngineActions>
          ) : (
            <DrainButton id={e.id} draining={e.draining} />
          )}
        </div>
      </div>

      <EngineConfigSyncChip engine={e.id} />
      <EngineRegistryActions id={e.id} initialName={e.name} initialUrl={e.url} />

      <nav aria-label="Engine sections" className="tabs">
        <ul>
          {TABS.map((t) => (
            <li key={t.id}>
              <Link href={t.id === "status" ? base : `${base}?tab=${t.id}`} className="tab" aria-current={tab === t.id ? "page" : undefined} scroll={false}>
                {t.label}
                {t.id === "tasks" && online && <span className="evo-count">{tasks.length}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "settings" ? <EngineSettings engine={e.id} /> : !online ? (
        <div className="evo-stack mt-4">
          <p className="attn-bad">This engine is unreachable{error ? ` (${error})` : ""}, so its tasks and queue controls are unavailable. Configuration can still be edited on the Settings tab.</p>
          <dl className="stat-row" aria-label="Last known numbers">
            <div><dt>Last good check</dt><dd>{e.lastOkAt ? fmt(e.lastOkAt) : "never"}</dd></div>
            <div><dt>Active jobs (last known)</dt><dd>{e.activeJobs}</dd></div>
            <div><dt>Queue (last known)</dt><dd>{e.queueDepth}</dd></div>
            <div><dt>Free disk</dt><dd>{e.freeDiskGb != null ? `${Math.round(e.freeDiskGb)} GB` : "—"}</dd></div>
          </dl>
          {e.lastError && <p className="evo-note">Last error: {e.lastError}</p>}
        </div>
      ) : tab === "status" ? (
        <div className="evo-stack mt-4">
          <section className="evo-section">
            <div className="evo-section-head"><h2>Right now</h2><span className="evo-muted">last good check {e.lastOkAt ? fmt(e.lastOkAt) : "never"}</span></div>
            <QueueStats engine={e.id} />
            <dl className="stat-row mt-3" aria-label="Engine">
              <div><dt>Free disk</dt><dd>{e.freeDiskGb != null ? `${Math.round(e.freeDiskGb)} GB` : "—"}</dd></div>
              <div><dt>Failed (last 100 tasks)</dt><dd>{e.failures ?? "—"}</dd></div>
            </dl>
          </section>
          <section className="evo-section">
            <div className="evo-section-head">
              <div>
                <h2>Stream providers</h2>
                <p className="evo-sub">A provider that keeps failing is skipped for a while (cool-down). Reset puts it back now.</p>
              </div>
            </div>
            <ProvidersPanel engine={e.id} />
          </section>
          <section className="evo-section">
            <div className="evo-section-head">
              <div>
                <h2>Extraction cost</h2>
                <p className="evo-sub">Last 24 hours, median / p95 per provider.</p>
              </div>
            </div>
            <MetricsPanel engine={e.id} />
          </section>
          <section className="evo-section">
            <div className="evo-section-head">
              <div>
                <h2>Pipeline</h2>
                <p className="evo-sub">Every try on this engine, by step. Live.</p>
              </div>
            </div>
            <SummaryFlow initial={summary} engine={e.id} />
          </section>
        </div>
      ) : tab === "tasks" ? (
        <section className="evo-section mt-4">
          <div className="evo-section-head">
            <div>
              <h2>Tasks on this engine <span className="evo-count">{tasks.length}</span></h2>
              <p className="evo-sub">Newest first, one row per try. Open one for its step-by-step log.</p>
            </div>
          </div>
          {!tasks.length ? (
            <p className="evo-empty">No tasks yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table evo-table">
                <thead>
                  <tr><th>Title</th><th>Quality</th><th>Status</th><th>Message</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.task_id}>
                      <td>
                        <Link href={`/admin/evo/${t.task_id}`} className="evo-title">{t.title ?? `TMDB ${t.tmdb_id}`}</Link>
                        <div className="evo-muted">{code(t.season, t.episode)}</div>
                      </td>
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
        </section>
      ) : null}
    </>
  );
}
