"use client";
import { useVisibleInterval } from "@/lib/client/use-visible-interval";

import Link from "next/link";
import { Fragment, useCallback, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import { NODES } from "@/lib/evo/flow";
import { JOURNEY_WINDOWS, OUTCOMES, OUTCOME_TEXT, waitText, type Journey, type JourneyReport, type Outcome } from "@/lib/evo/journeys";
import type { EngineCard } from "@/lib/evo/admin-view";
import { EngineRows, OverviewDecision, type FailureSamples } from "./evo-overview";
import { TZ } from "@/lib/tz";
import { TaskActions } from "./evo-controls";
import { SummaryFlow } from "./pipeline-graph";

const PAGE = 50;
const REFRESH_MS = 15_000;
const fmt = (d: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : `${d}Z`).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });
const stepLabel = (id: string | null) => (id ? (NODES.find((n) => n.id === id)?.label ?? id) : null);
const what = (j: Journey) => (j.mediaType === "tv" && j.season !== null ? `S${j.season}E${j.episode}` : "Movie") + (j.kind === "sinhala" ? " · Sinhala subtitles" : "");
const clip = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/**
 * What viewers went through, per title, instead of one row per engine task: did they finally get to watch, after how
 * many tries and how long. Failed tries that were followed by a success are folded into that title's row.
 */
export function JourneysPanel({ initial, multi, engines = [], failures = {}, asOf = 0 }: { initial: JourneyReport | null; multi: boolean; engines?: EngineCard[]; failures?: FailureSamples; asOf?: number }) {
  const [hours, setHours] = useState<number>(initial?.hours ?? 24);
  const [report, setReport] = useState(initial);
  const [filter, setFilter] = useState<Outcome | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [now, setNow] = useState(asOf);
  const asked = useRef(hours);

  const load = useCallback(async (h: number) => {
    const res = await fetchWithRefresh(`/api/admin/evo/journeys?hours=${h}`, { cache: "no-store" }).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    // A slow answer for the window the admin has already left must not overwrite the one they are looking at.
    if (body?.report && asked.current === h) { setReport(body.report); setNow(Date.now()); }
    if (asked.current === h) { setLoading(false); setLoadError(!body?.report); }
  }, []);

  useVisibleInterval(() => load(hours), REFRESH_MS, false);

  const pick = (h: number) => {
    if (h === hours) return;
    asked.current = h;
    setHours(h);
    setLoading(true);
    setShown(PAGE);
    void load(h);
  };

  const windows = (
    <div className="seg" role="group" aria-label="Time window">
      {JOURNEY_WINDOWS.map((h) => (
        <button key={h} type="button" className="btn-secondary" aria-pressed={hours === h} onClick={() => pick(h)}>
          {h === 24 ? "Last 24 hours" : "Last 7 days"}
        </button>
      ))}
    </div>
  );

  if (!report) {
    return (
      <div className="evo-stack">
        <OverviewDecision failures={failures} engines={engines} report={null} now={now} refresh={() => void load(hours)} />
        <section className="evo-section"><div className="evo-section-head"><h2>Viewers</h2>{windows}</div><p className="evo-empty">No engine could report viewer outcomes. Check that the engines are available and updated.</p></section>
        <section className="evo-section"><div className="evo-section-head"><h2>Engines</h2><p className="evo-sub">Failure rates: last 100 tries per engine, or fewer for a new engine.</p></div><EngineRows engines={engines} failures={failures} /></section>
      </div>
    );
  }

  const { totals } = report;
  const viewerSummary = { ...report.summary, steps: Object.fromEntries(NODES.map((node) => {
    const cell = report.summary.steps[node.id] ?? { ok: 0, failed: 0, running: 0, skipped: 0 };
    return [node.id, { ...cell, failed: report.journeys.filter((j) => j.outcome === "never" && j.trouble?.step === node.id).length }];
  })) };
  const total = OUTCOMES.reduce((sum, o) => sum + totals[o], 0);
  const needle = search.trim().toLowerCase();
  const rows = report.journeys.filter((j) => (!filter || j.outcome === filter) && (!needle || (j.title ?? `TMDB ${j.tmdbId}`).toLowerCase().includes(needle)));
  const toggle = (id: string) => setOpen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)));

  return (
    <div aria-busy={loading} className="evo-stack">
      <OverviewDecision failures={failures} engines={engines} report={report} now={now} refresh={() => void load(hours)} />
      <section className="evo-section">
        <div className="evo-section-head">
          <div>
            <h2>Viewers</h2>
            <p className="evo-sub">Each title counts once, by the try that decided it. The selected window applies to the verdict, metrics, fixes and titles.</p>
          </div>
          {windows}
        </div>
        {loading && <p className="evo-note" role="status">Loading the selected window; showing the last {report.hours} hours until it arrives.</p>}
        {loadError && <p className="evo-note" role="status">Could not refresh viewer outcomes. Showing the last available report ({report.hours} hours).</p>}

        {report.unreachable.length > 0 && <p className="evo-note">Could not read viewer outcomes from {report.unreachable.join(", ")} (offline, or not updated to the version that reports them).</p>}
        {report.truncated && <p className="evo-note">This window has more tries than the engine reports at once; the oldest are left out.</p>}
      </section>

      <section className="evo-section">
        <div className="evo-section-head">
          <div>
            <h2>Where it breaks</h2>
            <p className="evo-sub">Failed steps come first. Recovered steps had a failed try before a watchable result.</p>
          </div>
        </div>
        <SummaryFlow initial={viewerSummary} byJourney issuesOnly />
      </section>

      <section className="evo-section"><div className="evo-section-head"><h2>Engines</h2><p className="evo-sub">Failure rates: last 100 tries per engine, or fewer for a new engine.</p></div><EngineRows engines={engines} failures={failures} /></section>

      <section className="evo-section">
        <div className="evo-section-head">
          <h2>Titles <span className="evo-count">{rows.length}</span></h2>
          <div className="evo-filters">
            {filter && (
              <button type="button" className="chip" data-outcome={filter} onClick={() => setFilter(null)} aria-label={`Clear filter ${OUTCOME_TEXT[filter].label}`}>
                <i className="dot" aria-hidden="true" />{OUTCOME_TEXT[filter].label} <span aria-hidden="true">×</span>
              </button>
            )}
            <input type="search" className="evo-search" placeholder="Search titles" aria-label="Search titles" value={search} onChange={(e) => { setSearch(e.target.value); setShown(PAGE); }} />
          </div>
        </div>
        <div className="outcome-filters" role="group" aria-label="Filter titles by outcome">
          <button type="button" className="btn-secondary" aria-pressed={filter === null} onClick={() => { setFilter(null); setShown(PAGE); }}>All titles <strong>{total}</strong></button>
          {OUTCOMES.map((o) => <button key={o} type="button" className="btn-secondary" data-outcome={o} aria-pressed={filter === o} title={OUTCOME_TEXT[o].hint} onClick={() => { setFilter(filter === o ? null : o); setShown(PAGE); }}>{OUTCOME_TEXT[o].label} <strong>{totals[o]}</strong></button>)}
        </div>
        {!rows.length ? (
          <p className="evo-empty">{needle ? `No title matches “${search.trim()}”.` : filter ? `Nothing in “${OUTCOME_TEXT[filter].label}”.` : "Nothing here yet."}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table evo-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Result</th>
                  <th className="num hide-sm">Tries</th>
                  <th className="num hide-sm">Wait</th>
                  <th>What went wrong</th>
                  <th className="hide-sm">Last activity</th>
                  <th><span className="sr-only">Tries</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((j) => {
                  const expanded = open.has(j.id);
                  const step = stepLabel(j.trouble?.step ?? null);
                  return (
                    <Fragment key={j.id}>
                      <tr>
                        <td>
                          <Link href={`/admin/evo/${j.decisive.task_id}`} className="evo-title">{j.title ?? `TMDB ${j.tmdbId}`}</Link>
                          <div className="evo-muted">{what(j)}</div>
                        </td>
                        <td><span className="j-pill" data-outcome={j.outcome}>{OUTCOME_TEXT[j.outcome].label}</span></td>
                        <td className="num hide-sm">{j.tries}</td>
                        <td className="num nowrap hide-sm">{waitText(j.waitSeconds)}</td>
                        <td className="evo-why">
                          {j.trouble ? <>{step && <strong>{step}: </strong>}{clip(j.trouble.detail)}</> : <span className="evo-muted">—</span>}
                          {j.outcome === "struggled" && j.tries > 1 && <div className="evo-muted">failed {j.tries - 1}× before it worked</div>}
                        </td>
                        <td className="nowrap evo-muted hide-sm">{fmt(j.lastAt)}</td>
                        <td>
                          <button type="button" className="btn-link rounded-md border px-2 py-1 text-xs nowrap" aria-expanded={expanded} onClick={() => toggle(j.id)}>
                            {expanded ? "Hide" : "Show"} {j.tasks.length > 1 ? `${j.tasks.length} tries` : "try"}
                          </button>
                        </td>
                      </tr>
                      {expanded && j.tasks.map((t, i) => (
                        <tr key={t.task_id} className="j-tries">
                          <td>
                            <Link href={`/admin/evo/${t.task_id}`}>Try {i + 1}</Link>
                            <div className="evo-muted">{fmt(t.created_at)}</div>
                          </td>
                          <td>{t.watchable ? <span className="j-pill" data-outcome="smooth">watchable</span> : <span className="j-pill" data-outcome={t.status === "FAILED" ? "never" : "trying"}>{t.status.toLowerCase()}</span>}</td>
                          <td colSpan={2} className="hide-sm">{multi && <>{t.engineName} · </>}{j.kind === "sinhala" ? "Sinhala" : (t.resolved_quality ?? t.quality)}</td>
                          <td className="evo-why">{t.failed_step && <strong>{stepLabel(t.failed_step)}: </strong>}{clip(t.failed_detail || t.message, 140)}</td>
                          <td className="hide-sm" />
                          <td><TaskActions id={t.task_id} status={t.status} cacheFailed={t.cache_failed} canMove={multi && j.kind === "video"} /></td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > shown && <button type="button" className="btn-link mt-3 rounded-md border px-3 py-1.5 text-sm" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}</button>}
        <p className="evo-note">Counted from engine tries: a cached title watched by many people counts as one title. Still-trying titles are included in these filters and excluded from the watch-success denominator.</p>
      </section>
    </div>
  );
}
