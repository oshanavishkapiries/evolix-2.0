"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { LOW_DISK_GB, attentionItems, groupStuckTitles, healthLine, highFailureRate, relativeAge, topFailingStep, engineState, providerName, shortEngine, type Attention, type EngineCard, type FailureSamples } from "@/lib/evo/admin-view";
import { OUTCOMES, waitText, type JourneyReport } from "@/lib/evo/journeys";
import { TaskActions } from "./evo-controls";
import { TZ } from "@/lib/tz";
import { useToast } from "./toast";

const time = (d: string | null) => (d ? new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "never");

export function StatusPill({ tone, text }: { tone: "ok" | "warn" | "bad"; text: string }) {
  return <span className="pill" data-tone={tone}><i aria-hidden="true" />{text}</span>;
}

/** A thin meter; `value` of `max`, coloured by how full it is. */
function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <span className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} data-level={pct >= 90 ? "bad" : pct >= 60 ? "warn" : "ok"}><span style={{ width: `${pct}%` }} /></span>;
}

export function EngineCards({ engines }: { engines: EngineCard[] }) {
  return (
    <div className="engine-grid">
      {engines.map((e) => {
        const { label, host } = shortEngine(e.name, e.url);
        const st = engineState(e);
        const href = `/admin/evo/engines/${encodeURIComponent(e.id)}`;
        const limit = e.queue?.queue_limit ?? 0;
        return (
          <article key={e.id} className="engine-card" data-tone={st.tone} aria-label={`Engine ${label}`}>
            <header>
              <div>
                <Link href={href} className="engine-name">{label}</Link>
                <span className="engine-host">{host}</span>
              </div>
              <StatusPill {...st} />
            </header>
            {!e.available && e.lastError && <p className="engine-error">{e.lastError}</p>}
            <dl className="engine-stats">
              <div>
                <dt>Working on</dt>
                <dd>{e.activeJobs}<small> job(s)</small></dd>
              </div>
              <div>
                <dt>Queue</dt>
                <dd>{e.queueDepth}{limit > 0 && <small> / {limit}</small>}</dd>
                {limit > 0 && <Meter value={e.queueDepth} max={limit} label="Queue use" />}
              </div>
              <div>
                <dt>Free disk</dt>
                <dd data-warn={e.freeDiskGb != null && e.freeDiskGb < LOW_DISK_GB}>{e.freeDiskGb != null ? <>{Math.round(e.freeDiskGb)}<small> GB</small></> : "—"}</dd>
              </div>
              <div>
                <dt>Failed (last 100)</dt>
                <dd data-warn={(e.failures ?? 0) > 0}>{e.failures ?? "—"}</dd>
              </div>
            </dl>
            <footer>
              <ul className="prov-list" aria-label="Providers">
                {(e.providers ?? []).map((p) => (
                  <li key={p.name} data-state={p.state} title={p.state === "healthy" ? `${p.recent_failures} recent failure(s)` : p.state === "cooling" ? "Cooling down" : "Next job is a trial"}>
                    <i aria-hidden="true" />{providerName(p.name)}
                  </li>
                ))}
                {!e.providers && <li className="evo-muted">providers unknown</li>}
              </ul>
              <span className="evo-muted">checked {time(e.lastOkAt)}</span>
              <Link href={href} className="btn-link rounded-md border px-2 py-1 text-xs">Open →</Link>
            </footer>
          </article>
        );
      })}
    </div>
  );
}

export function AttentionList({ items }: { items: Attention[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const reset = async (a: Attention) => {
    setBusy(a.key);
    const res = await adminApi("POST", `/api/admin/evo/providers/${encodeURIComponent(a.provider!)}/reset?engine=${encodeURIComponent(a.engine!)}`);
    setBusy(null);
    if (!res.ok) return toast.error(errorText(res));
    toast.success(`${providerName(a.provider!)} is back in rotation`);
    router.refresh();
  };
  if (!items.length) return <p className="attn-ok"><i aria-hidden="true" />Nothing needs you right now.</p>;
  return (
    <ul className="attn-list">
      {items.map((a) => (
        <li key={a.key} data-level={a.level}>
          <i aria-hidden="true" />
          <div className="attn-text">
            <strong>{a.text}</strong>
            {a.detail && <span>{a.detail}</span>}
          </div>
          {a.provider && a.engine && <button type="button" className="btn-secondary rounded-md border px-2 py-1 text-xs" disabled={busy === a.key} onClick={() => reset(a)}>Reset</button>}
          {a.href && <Link href={a.href} className="btn-link rounded-md border px-2 py-1 text-xs">Open</Link>}
        </li>
      ))}
    </ul>
  );
}


export type { FailureSamples } from "@/lib/evo/admin-view";

/** Compact overview rows; the existing cards remain available to other pages. */
export function EngineRows({ engines, failures }: { engines: EngineCard[]; failures: FailureSamples }) {
  const known = engines.map((e) => failures[e.id]?.rate).filter((r): r is number => r != null);
  const best = known.length ? Math.min(...known) : null;
  return <div className="engine-rows">{engines.map((e) => {
    const { label, host } = shortEngine(e.name, e.url);
    const state = engineState(e);
    const sample = failures[e.id];
    const warn = highFailureRate(sample?.rate ?? null, best);
    return <article className="engine-row" key={e.id} aria-label={`Engine ${label}`}>
      <Link href={`/admin/evo/engines/${encodeURIComponent(e.id)}`} className="evo-title" title={host}>{label}</Link>
      <StatusPill {...state} />
      <span><strong>{e.activeJobs}</strong> active tries</span>
      <span data-tone={warn ? "warn" : undefined} className={warn ? "engine-rate-warning" : ""} title={`Failures or cache failures in the last ${sample?.size ?? 0} tries (up to 100)`}>
        <strong>{sample?.rate != null ? `${Math.round(sample.rate)}%` : "—"}</strong> failed <small className="evo-muted">/ {sample?.size ?? 0} tries</small>{warn && " · high"}
      </span>
      <span data-tone={e.freeDiskGb != null && e.freeDiskGb < LOW_DISK_GB ? "warn" : undefined} className="engine-disk"><strong>{e.freeDiskGb != null ? `${Math.round(e.freeDiskGb)} GB` : "—"}</strong> free</span>
      <ul className="prov-list" aria-label={`${label} providers`}>{(e.providers ?? []).map((p) => <li key={p.name} data-state={p.state} title={`${providerName(p.name)}: ${p.state}`}><i aria-hidden="true" /><span className="sr-only">{providerName(p.name)}: {p.state}</span></li>)}{!e.providers && <li>unknown providers</li>}</ul>
      <Link href={`/admin/evo/engines/${encodeURIComponent(e.id)}`} className="btn-link-plain" aria-label={`Open ${label} engine`}>Open →</Link>
    </article>;
  })}</div>;
}

export function OverviewDecision({ engines, report: received, now, refresh, failures = {} }: { engines: EngineCard[]; report: JourneyReport | null; now: number; refresh: () => void; failures?: FailureSamples }) {
  const unavailable = engines.length > 0 && (received?.unreachable.length ?? 0) >= engines.length;
  const report = unavailable ? null : received;
  const health = healthLine(engines, report?.totals, { failures, viewerIncomplete: !!report?.unreachable.length });
  const attention = attentionItems(engines, []);
  const groups = groupStuckTitles(report?.journeys ?? []);
  const total = report ? OUTCOMES.reduce((n, o) => n + report.totals[o], 0) : 0;
  const trying = report?.totals.trying ?? 0;
  const finished = total - trying;
  const watched = report ? report.totals.smooth + report.totals.struggled : 0;
  const top = topFailingStep(report?.journeys ?? []);
  const sum = (f: (e: EngineCard) => number) => engines.reduce((n, e) => n + f(e), 0);
  return <>
    <div className="health verdict" data-tone={health.level} role="status">
      <strong className="verdict-text">{health.text}</strong>
      <ul><li>{sum((e) => e.queue?.extracting ?? e.activeJobs)} extracting</li><li>{sum((e) => e.queue?.caching ?? 0)} caching</li><li>{sum((e) => e.queue?.waiting_extraction ?? e.queueDepth)} waiting</li></ul>
    </div>
    <div className="kpis decision-kpis" aria-label="Viewer metrics">
      <div className="kpi"><span className="kpi-label">Watch success</span><strong className="kpi-value">{finished ? `${Math.round(watched / finished * 100)}%` : "—"}</strong><span className="kpi-note">{report ? `${watched} of ${finished} finished titles; ${trying} still trying` : "Viewer outcomes unavailable"}</span></div>
      <div className="kpi" data-tone={(report?.totals.never ?? 0) > 0 ? "bad" : "ok"}><span className="kpi-label">Stuck titles</span><strong className="kpi-value">{report?.totals.never ?? "—"}</strong><span className="kpi-note">No try ended watchable</span></div>
      <div className="kpi"><span className="kpi-label">Typical wait</span><strong className="kpi-value">{waitText(report?.medianWaitSeconds ?? null)}</strong><span className="kpi-note">Median, first try to stream ready</span></div>
      <div className="kpi"><span className="kpi-label">Top failing step</span><strong className="kpi-value kpi-step">{top?.label ?? "—"}</strong><span className="kpi-note">{top ? `${top.count} ${top.count === 1 ? "title" : "titles"} stuck here` : "No known failing step"}</span></div>
    </div>
    <section className="evo-section"><div className="evo-section-head"><h2>Fix these{attention.length + groups.length > 0 && <span className="evo-count" data-tone={groups.length || attention.some((a) => a.level === "bad") ? "bad" : "warn"}>{attention.length + groups.length}</span>}</h2></div>
      {attention.length > 0 && <AttentionList items={attention} />}
      {groups.map((group) => <StuckGroup key={group.key} group={group} multi={engines.length > 1} now={now} refresh={refresh} />)}
      {!attention.length && !groups.length && <p className="evo-empty">{report ? "No fixes needed in this window." : "Viewer outcomes unavailable; check engines below."}</p>}
    </section>
  </>;
}

function StuckGroup({ group, multi, now, refresh }: { group: ReturnType<typeof groupStuckTitles>[number]; multi: boolean; now: number; refresh: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const retryAll = async () => {
    setBusy(true);
    let succeeded = 0;
    for (const j of group.titles) {
      const result = await adminApi("POST", `/api/admin/evo/tasks/${encodeURIComponent(j.decisive.task_id)}/retry`);
      if (result.ok) succeeded++;
    }
    setBusy(false);
    const message = `${succeeded} of ${group.titles.length} titles queued for retry${succeeded < group.titles.length ? `; ${group.titles.length - succeeded} failed to queue` : ""}`;
    if (succeeded === group.titles.length) toast.success(message); else toast.error(message);
    refresh();
    router.refresh();
  };
  return <article className="cause-group" data-tone="bad" aria-busy={busy}>
    <header><div><h3>{group.cause} <span className="evo-count" data-tone="bad">{group.titles.length}</span></h3><p className="evo-sub">{group.hint}</p><p className="evo-muted">Newest failure {relativeAge(group.newestAt, now)}</p></div><button type="button" className="btn-secondary rounded-md border px-3 py-1.5 text-sm" disabled={busy} onClick={() => void retryAll()}>{busy ? "Retrying…" : "Retry all"}</button></header>
    <ul>{(expanded ? group.titles : group.titles.slice(0, 8)).map((j) => <li key={j.id} title={j.trouble?.detail}>
      <Link href={`/admin/evo/${j.decisive.task_id}`} className="evo-title">{j.title ?? `TMDB ${j.tmdbId}`}{j.mediaType === "tv" && j.season !== null ? ` S${j.season}E${j.episode}` : ""}{j.kind === "sinhala" ? " · Sinhala subtitles" : ""}</Link>
      <fieldset disabled={busy} aria-label={`Actions for ${j.title ?? `TMDB ${j.tmdbId}`}`}><TaskActions id={j.decisive.task_id} status={j.decisive.status} cacheFailed={j.decisive.cache_failed} canMove={multi && j.kind === "video"} /></fieldset>
    </li>)}</ul>
    {group.titles.length > 8 && <button type="button" className="btn-link-plain" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer titles" : `+${group.titles.length - 8} more titles`}</button>}
  </article>;
}
