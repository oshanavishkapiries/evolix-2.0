"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import type { OrModel } from "@/lib/openrouter";
import { useToast } from "./toast";

type EngineModel = { id: string; name: string; model: string | null; error?: string };
type Applied = { model: string; engines: { id: string; name: string; ok: boolean; error?: string }[] };

const btn = "btn-secondary rounded-md border px-3 py-1.5 text-sm";
const price = (n: number) => (n === 0 ? "free" : `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`);

/**
 * Which OpenRouter model translates subtitles to Sinhala. One choice for every engine; it applies to the next
 * subtitle job (nothing already translated changes) and needs no restart.
 */
export function TranslateModel({ models }: { models: OrModel[] }) {
  const toast = useToast();
  const [engines, setEngines] = useState<EngineModel[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await adminApi<{ data: EngineModel[] }>("GET", "/api/admin/openrouter/model");
    if (!res.ok) return toast.error(errorText(res));
    setEngines(res.data);
    setPick((cur) => cur || res.data.find((e) => e.model)?.model || "");
  }, [toast]);

  useEffect(() => {
    // Initial read; the state is set after the request resolves.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  const chosen = byId.get(pick.trim());
  const differs = engines?.some((e) => e.model !== pick.trim()) ?? false;
  const unknown = models.length > 0 && pick.trim() !== "" && !chosen;

  const apply = async () => {
    setBusy(true);
    const res = await adminApi<{ data: Applied }>("PUT", "/api/admin/openrouter/model", { model: pick.trim() });
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    const failed = res.data.engines.filter((e) => !e.ok);
    if (failed.length) toast.error(`Not applied on: ${failed.map((e) => `${e.name} (${e.error})`).join(", ")}`);
    else toast.success(`Translation model is now ${res.data.model} on ${res.data.engines.length} engine(s)`);
    await load();
  };

  return (
    <section>
      <h2>Translation model</h2>
      <p className="text-sm">The model that translates English subtitles to Sinhala. It applies to the next subtitle job on every engine; subtitles that already exist stay as they are.</p>

      {!engines ? (
        <div className="skeleton mt-2 h-24" aria-busy="true" />
      ) : (
        <div className="table-wrap mt-2">
          <table className="data-table">
            <thead>
              <tr><th>Engine</th><th>Model in use</th></tr>
            </thead>
            <tbody>
              {engines.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td>{e.model ?? <span className="text-sm">{e.error ?? "unknown"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="toolbar mt-3" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 22rem" }}>
          <span className="text-sm">Model (start typing to search OpenRouter&rsquo;s list)</span>
          <input list="or-models" value={pick} onChange={(e) => setPick(e.target.value)} placeholder="google/gemini-3.1-flash-lite" spellCheck={false} autoComplete="off" style={{ width: "100%" }} />
          <datalist id="or-models">
            {models.map((m) => (
              <option key={m.id} value={m.id}>{`${m.name} · ${price(m.promptPer1M)} in / ${price(m.completionPer1M)} out per 1M tokens`}</option>
            ))}
          </datalist>
        </label>
        <button type="button" disabled={busy || !pick.trim() || !differs || unknown} onClick={apply}>
          {busy ? "Applying…" : "Apply to all engines"}
        </button>
      </div>

      {chosen && (
        <p className="mt-2 text-sm">
          {chosen.name}: {price(chosen.promptPer1M)} per 1M input tokens, {price(chosen.completionPer1M)} per 1M output tokens
          {chosen.context ? `, ${Math.round(chosen.context / 1000)}k context` : ""}.
        </p>
      )}
      {unknown && <p className="mt-2 text-sm">That is not a model OpenRouter lists. Pick one from the suggestions.</p>}
      {models.length === 0 && <p className="mt-2 text-sm">OpenRouter&rsquo;s model list could not be loaded, so the id cannot be checked here. The engines still refuse anything that is not shaped like <code>vendor/model</code>.</p>}
      <p className="mt-2 text-sm">
        Sinhala needs a model that follows the answer format exactly (each line starts with the cue number and its first and last English word). A model that does not will make jobs fail instead of saving a wrong subtitle.
      </p>
      <button type="button" className={`${btn} mt-2`} onClick={load}>Refresh</button>
    </section>
  );
}
