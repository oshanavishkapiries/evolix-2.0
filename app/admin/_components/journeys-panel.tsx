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
    const tick = setInterval(() => void load(hours), REFRESH_MS);
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

  if (!report) {
    return <p className="mt-2 text-sm">No engine could report what viewers went through. Rebuild the engines if they were not updated yet.</p>;
  }

  const { totals } = report;
  const total = OUTCOMES.reduce((sum, o) => sum + totals[o], 0);
  const decided = total - totals.trying;
  const watched = totals.smooth + totals.struggled;
  const rows = report.journeys.filter((j) => !filter || j.outcome === filter);
  const toggle = (id: string) => setOpen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)));

  return (
    <div aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" role="status">
          {total === 0
            ? "No viewer activity in this window."
            : decided === 0
              ? `${total} title(s) in progress.`
              : <><strong>{Math.round((watched / decided) * 100)}%</strong> of {decided} title(s) ended with the viewer able to watch{report.medianWaitSeconds !== null && <> · typical wait {waitText(report.medianWaitSeconds)}</>}.</>}
        </p>
        <div className="flex gap-2" role="group" aria-label="Time window">
          {JOURNEY_WINDOWS.map((h) => (
            <button key={h} type="button" className="btn-link rounded-md border px-3 py-1.5 text-sm" aria-pressed={hours === h} onClick={() => pick(h)}>
              {h === 24 ? "Last 24 hours" : "Last 7 days"}
            </button>
          ))}
        </div>
      </div>

      <div className="j-cards mt-3">
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
      {report.unreachable.length > 0 && <p className="mt-2 text-sm">Could not read journeys from {report.unreachable.join(", ")} (offline, or not updated to the version that reports them).</p>}
      {report.truncated && <p className="mt-2 text-sm">This window has more tasks than the engine reports at once; the oldest are left out.</p>}

      <h3 className="mt-5">Where viewers get stuck</h3>
      <p className="flow-hint">Each title counts once, by the try that decided it. Red: stuck here for good. Yellow: failed here on an earlier try, still got through.</p>
      <div className="mt-2">
        <SummaryFlow initial={report.summary} byJourney />
      </div>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
        <h3>Titles</h3>
        {filter && <button type="button" className="btn-link rounded-md border px-3 py-1 text-sm" onClick={() => setFilter(null)}>Show all {total}</button>}
      </div>
      {!rows.length ? (
        <p className="mt-2 text-sm">{filter ? `Nothing in “${OUTCOME_TEXT[filter].label}”.` : "Nothing here yet."}</p>
      ) : (
        <div className="table-wrap mt-2">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Result</th>
                <th>Tries</th>
                <th>Wait</th>
                <th>What went wrong</th>
                <th>Last activity</th>
                <th />
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
                        <Link href={`/admin/evo/${j.decisive.task_id}`}>{j.title ?? `TMDB ${j.tmdbId}`}</Link>
                        <div className="text-xs">{what(j)}</div>
                      </td>
                      <td><span className="j-pill" data-outcome={j.outcome}>{OUTCOME_TEXT[j.outcome].label}</span></td>
                      <td>{j.tries}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{waitText(j.waitSeconds)}</td>
                      <td style={{ maxWidth: "26rem", overflowWrap: "anywhere" }}>
                        {j.trouble ? <>{step && <strong>{step}: </strong>}{clip(j.trouble.detail)}</> : "—"}
                        {j.outcome === "struggled" && j.tries > 1 && <div className="text-xs">failed {j.tries - 1}× before it worked</div>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmt(j.lastAt)}</td>
                      <td>
                        <button type="button" className="btn-link rounded-md border px-2 py-1 text-xs" aria-expanded={expanded} onClick={() => toggle(j.id)}>
                          {expanded ? "Hide" : "Show"} {j.tasks.length > 1 ? `${j.tasks.length} tries` : "try"}
                        </button>
                      </td>
                    </tr>
                    {expanded && j.tasks.map((t, i) => (
                      <tr key={t.task_id} className="j-tries">
                        <td>
                          <Link href={`/admin/evo/${t.task_id}`}>Try {i + 1}</Link>
                          <div className="text-xs">{fmt(t.created_at)}</div>
                        </td>
                        <td>{t.watchable ? <span className="j-pill" data-outcome="smooth">watchable</span> : <span className="j-pill" data-outcome={t.status === "FAILED" ? "never" : "trying"}>{t.status.toLowerCase()}</span>}</td>
                        <td colSpan={2}>{multi && <>{t.engineName} · </>}{j.kind === "sinhala" ? "Sinhala" : (t.resolved_quality ?? t.quality)}</td>
                        <td style={{ overflowWrap: "anywhere" }}>{t.failed_step && <strong>{stepLabel(t.failed_step)}: </strong>}{clip(t.failed_detail || t.message, 140)}</td>
                        <td />
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
      <p className="flow-hint">Counted from the engines&rsquo; tasks: a title that was already cached and watched by many people is one smooth journey, not one per viewer.</p>
    </div>
  );
}
