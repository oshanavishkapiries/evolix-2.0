"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import { NODES } from "@/lib/evo/flow";
import { JOURNEY_WINDOWS, OUTCOMES, OUTCOME_TEXT, waitText, type Journey, type JourneyReport, type Outcome } from "@/lib/evo/journeys";
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
export function JourneysPanel({ initial, multi }: { initial: JourneyReport | null; multi: boolean }) {
  const [hours, setHours] = useState<number>(initial?.hours ?? 24);
  const [report, setReport] = useState(initial);
  const [filter, setFilter] = useState<Outcome | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const asked = useRef(hours);

  const load = useCallback(async (h: number) => {
    const res = await fetchWithRefresh(`/api/admin/evo/journeys?hours=${h}`, { cache: "no-store" }).catch(() => null);
    const body = res?.ok ? await res.json() : null;
    // A slow answer for the window the admin has already left must not overwrite the one they are looking at.
    if (body?.report && asked.current === h) setReport(body.report);
    if (asked.current === h) setLoading(false);
  }, []);

  useEffect(() => {
    const tick = setInterval(() => document.visibilityState === "visible" && void load(hours), REFRESH_MS);
    return () => clearInterval(tick);
  }, [hours, load]);

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
      <section className="evo-section">
        <div className="evo-section-head"><h2>Viewers</h2></div>
        <p className="evo-empty">No engine could report what viewers went through. Rebuild the engines if they were not updated yet.</p>
      </section>
    );
  }

  const { totals } = report;
  const total = OUTCOMES.reduce((sum, o) => sum + totals[o], 0);
  const decided = total - totals.trying;
  const watched = totals.smooth + totals.struggled;
  const needle = search.trim().toLowerCase();
  const rows = report.journeys.filter((j) => (!filter || j.outcome === filter) && (!needle || (j.title ?? `TMDB ${j.tmdbId}`).toLowerCase().includes(needle)));
  const toggle = (id: string) => setOpen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)));

  return (
    <div aria-busy={loading} className="evo-stack">
      <section className="evo-section">
        <div className="evo-section-head">
          <div>
            <h2>Viewers</h2>
            <p className="evo-sub">Each title counts once, by the try that decided it.</p>
          </div>
          {windows}
        </div>

        <div className="kpis">
          <div className="kpi" role="status">
            <span className="kpi-label">Watch success</span>
            <strong className="kpi-value">{decided ? `${Math.round((watched / decided) * 100)}%` : "—"}</strong>
            <span className="kpi-note">{total === 0 ? "No viewer activity in this window" : decided === 0 ? `${total} title(s) in progress` : `of ${decided} title(s) ended watchable`}</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Typical wait</span>
            <strong className="kpi-value">{report.medianWaitSeconds !== null ? waitText(report.medianWaitSeconds) : "—"}</strong>
            <span className="kpi-note">first try to stream ready</span>
          </div>
          {OUTCOMES.map((o) => (
            <button key={o} type="button" className="j-card" data-outcome={o} aria-pressed={filter === o} title={OUTCOME_TEXT[o].hint} onClick={() => { setFilter(filter === o ? null : o); setShown(PAGE); }}>
              <strong>{totals[o]}</strong>
              <span>{OUTCOME_TEXT[o].label}</span>
              <small>{OUTCOME_TEXT[o].hint}</small>
            </button>
          ))}
        </div>
        {total > 0 && (
          <div className="j-bar" aria-hidden="true">
            {OUTCOMES.map((o) => totals[o] > 0 && <span key={o} data-outcome={o} style={{ width: `${(totals[o] / total) * 100}%`, background: "var(--j)" }} />)}
          </div>
        )}
        {report.unreachable.length > 0 && <p className="evo-note">Could not read journeys from {report.unreachable.join(", ")} (offline, or not updated to the version that reports them).</p>}
        {report.truncated && <p className="evo-note">This window has more tasks than the engine reports at once; the oldest are left out.</p>}
      </section>

      <section className="evo-section">
        <div className="evo-section-head">
          <div>
            <h2>Where it breaks</h2>
            <p className="evo-sub">Red: viewers stuck here for good. Yellow: failed here once, still got through. Click a step for its numbers.</p>
          </div>
        </div>
        <SummaryFlow initial={report.summary} byJourney />
      </section>

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
        <p className="evo-note">Counted from the engines&rsquo; tasks: a title that was already cached and watched by many people is one smooth journey, not one per viewer.</p>
      </section>
    </div>
  );
}
