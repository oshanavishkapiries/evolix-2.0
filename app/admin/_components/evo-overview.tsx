"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { LOW_DISK_GB, engineState, providerName, shortEngine, type Attention, type EngineCard } from "@/lib/evo/admin-view";
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
