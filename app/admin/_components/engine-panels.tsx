"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { useConfirm } from "./confirm-dialog";
import { useToast } from "./toast";

const btn = "btn-secondary rounded-md border px-3 py-1.5 text-sm";
const q = (engine: string) => `?engine=${encodeURIComponent(engine)}`;

/** Drain / return to rotation. A draining engine takes no new jobs and finishes the active ones. */
export function DrainButton({ id, draining }: { id: string; draining: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const set = async (to: boolean) => {
    if (to && !(await confirm({ title: "Drain this engine?", body: "It takes no new jobs and finishes the ones it has. When it is empty it is shown as safe to remove. You can put it back at any time.", confirmLabel: "Start draining", danger: false }))) return;
    setBusy(true);
    const res = await adminApi("PATCH", `/api/admin/evo/engines/${encodeURIComponent(id)}`, { draining: to });
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    toast.success(to ? "Draining: no new jobs will be assigned" : "Back in rotation");
    router.refresh();
  };
  return (
    <button type="button" className={btn} disabled={busy} onClick={() => set(!draining)}>
      {draining ? "Return to rotation" : "Drain"}
    </button>
  );
}

type Provider = { name: string; state: "healthy" | "cooling" | "trial"; cooling_until: number | null; recent_failures: number };

/** Provider health with a manual reset (ends a cool-down). */
export function ProvidersPanel({ engine }: { engine: string }) {
  const toast = useToast();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await adminApi<{ data: Provider[] }>("GET", `/api/admin/evo/providers${q(engine)}`);
    if (res.ok) {
      setProviders(res.data);
      setError("");
    } else setError(errorText(res));
  }, [engine]);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const reset = async (name: string) => {
    const res = await adminApi<{ data: Provider[] }>("POST", `/api/admin/evo/providers/${encodeURIComponent(name)}/reset${q(engine)}`);
    if (!res.ok) return toast.error(errorText(res));
    setProviders(res.data);
    toast.success(`${name.replace(/StreamExtractor$/, "")} is back in rotation`);
  };

  if (error) return <p className="evo-empty">{error}</p>;
  if (!providers) return <div className="skeleton h-16" aria-busy="true" />;
  return (
    <ul className="prov-cards">
      {providers.map((p) => (
        <li key={p.name} data-state={p.state}>
          <div>
            <strong><i aria-hidden="true" />{p.name.replace(/StreamExtractor$/, "")}</strong>
            <span>
              {p.state === "healthy" && (p.recent_failures ? `Healthy · ${p.recent_failures} recent failure(s)` : "Healthy")}
              {p.state === "cooling" && `Cooling down until ${new Date((p.cooling_until ?? 0) * 1000).toLocaleTimeString("en-GB")}`}
              {p.state === "trial" && "Cool-down over: the next job is a trial"}
            </span>
          </div>
          {p.state !== "healthy" && <button type="button" className={btn} onClick={() => reset(p.name)}>Reset</button>}
        </li>
      ))}
    </ul>
  );
}

type Stat = { median: number; p95: number };
type Metrics = { window_hours: number; providers: Record<string, { attempts: number; ok: number; failed: number; browser_launches: number; duration_s: Stat; peak_rss_mb: Stat; cpu_s: Stat }> };
const pair = (s: Stat, unit: string, digits = 1) => `${s.median.toFixed(digits)} / ${s.p95.toFixed(digits)}${unit}`;

/** Median and p95 extraction duration, RAM and CPU per provider, last 24 hours. */
export function MetricsPanel({ engine }: { engine: string }) {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    adminApi<{ data: Metrics }>("GET", `/api/admin/evo/metrics${q(engine)}`).then((res) => {
      if (!alive) return;
      if (res.ok) setData(res.data);
      else setError(errorText(res));
    });
    return () => {
      alive = false;
    };
  }, [engine]);
  if (error) return <p className="evo-empty">{error}</p>;
  if (!data) return <div className="skeleton h-16" aria-busy="true" />;
  const rows = Object.entries(data.providers);
  if (!rows.length) return <p className="evo-empty">No extractions in the last {data.window_hours} hours.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table evo-table">
        <thead>
          <tr><th>Provider</th><th>Attempts</th><th>Time (median / p95)</th><th>Peak RAM (median / p95)</th><th>CPU (median / p95)</th><th>New browsers</th></tr>
        </thead>
        <tbody>
          {rows.map(([name, m]) => (
            <tr key={name}>
              <td>{name.replace(/StreamExtractor$/, "")}</td>
              <td>{m.attempts} ({m.ok} ok, {m.failed} failed)</td>
              <td>{pair(m.duration_s, " s")}</td>
              <td>{pair(m.peak_rss_mb, " MB", 0)}</td>
              <td>{pair(m.cpu_s, " s")}</td>
              <td>{m.browser_launches}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
