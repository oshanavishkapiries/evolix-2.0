"use client";
import { useCallback, useEffect, useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { configFields as configRegistry } from "@/lib/config/metadata";
import { configChanges, configValidation, groupConfig, type AdminConfigRow } from "@/lib/config/admin-form";
import { SaveBar, useDirtyForm } from "./form-kit";
import { useConfirm } from "./confirm-dialog";
import { useToast } from "./toast";

type Snapshot = { data: AdminConfigRow[]; bootstrap: Record<string, string> };
type Audit = { id: string; key: string; at: string; actor: string; action: string; oldValue: string | null; newValue: string | null; canRollback: boolean; reason?: string };
const jwt = (key: string) => key === "JWT_ACCESS_SECRET" || key === "JWT_REFRESH_SECRET";
export function ConfigPanel({ view = "all" }: { view?: "all" | "settings" | "history" }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Audit[]>([]);
  const [filter, setFilter] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [cursor, setCursor] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [historyError, setHistoryError] = useState("");
  const form = useDirtyForm({});
  const { markSaved } = form;
  const confirm = useConfirm();
  const toast = useToast();
  const load = useCallback(async () => {
    const res = await adminApi<Snapshot>("GET", "/api/admin/config");
    if (!res.ok) return setError(errorText(res));
    setSnapshot({ data: res.data, bootstrap: res.bootstrap });
    markSaved(Object.fromEntries(res.data.map((r) => [r.key, configRegistry.find((e) => e.key === r.key)?.secret ? "" : String(r.value)])));
  }, [markSaved]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  useEffect(() => {
    let alive = true;
    adminApi<{ data: Audit[]; next: string | null }>("GET", `/api/admin/config/audit?${new URLSearchParams({ ...(filter ? { key: filter } : {}), ...(cursor ? { before: cursor } : {}) })}`).then((res) => {
      if (!alive) return;
      setHistoryError(res.ok ? "" : errorText(res));
      if (res.ok) { setHistory(res.data); setNext(res.next); }
    });
    return () => { alive = false; };
  }, [filter, cursor, historyVersion]);
  const accept = (res: Snapshot) => {
    setSnapshot({ data: res.data, bootstrap: res.bootstrap });
    markSaved(Object.fromEntries(res.data.map((r) => [r.key, configRegistry.find((e) => e.key === r.key)?.secret ? "" : String(r.value)])));
    setErrors({}); setCursor(""); setHistoryVersion((v) => v + 1);
  };
  const changes = configChanges(snapshot?.data ?? [], form.values);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const invalid = Object.fromEntries(Object.entries(changes).flatMap(([key, value]) => { const message = configValidation(key, value); return message ? [[key, message]] : []; }));
    setErrors(invalid);
    if (Object.keys(invalid).length) return;
    if (Object.keys(changes).some(jwt) && !await confirm({ title: "Rotate signing secrets?", body: "Everyone will be signed out. You will need to sign in again after saving.", confirmLabel: "Rotate and sign everyone out" })) return;
    setBusy(true);
    const res = await adminApi<Snapshot & { errors?: Record<string, string> }>("PUT", "/api/admin/config", changes);
    setBusy(false);
    if (!res.ok) { setErrors(res.errors ?? {}); return toast.error(errorText(res)); }
    accept(res); toast.success("Configuration saved");
  };
  const mutate = async (path: string, method: "POST" | "DELETE", title: string, body: string) => {
    if (!await confirm({ title, body: `${body}${form.dirty ? " Your unsaved edits will be discarded." : ""}`, confirmLabel: "Confirm" })) return;
    setBusy(true);
    const res = await adminApi<Snapshot>(method, path);
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    accept(res); toast.success("Configuration updated");
  };
  if (error) return <p role="alert">{error} <button onClick={() => { setError(""); void load(); }}>Retry</button></p>;
  if (!snapshot) return <p aria-busy="true">Loading configuration…</p>;
  return <div className="config-panel">
    {view !== "history" && <><form onSubmit={save}>
      <fieldset disabled={busy}>
        {groupConfig(snapshot.data).map(({ group, items }) => <section className="config-card" key={group} aria-labelledby={`config-${group}`}>
          <h2 id={`config-${group}`}>{group}</h2>
          {items.map((entry) => {
            const value = String(form.values[entry.key] ?? "");
            const message = errors[entry.key] ?? configValidation(entry.key, value);
            const props = { id: entry.key, value, "aria-invalid": Boolean(message), "aria-describedby": `${entry.key}-help`, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { form.setValues((old) => ({ ...old, [entry.key]: event.target.value })); setErrors((old) => { const copy = { ...old }; delete copy[entry.key]; return copy; }); } };
            return <div className="config-row" key={entry.key} data-dirty={entry.key in changes}>
              <div><label htmlFor={entry.key}>{entry.label}{entry.secret ? " · Replace" : ""}</label><p>{entry.description}</p><code>{entry.key}</code>
                {(entry.key === "EVO_ENGINES" || entry.key === "EVO_SECRET_TOKEN") && <p>Engines move to their own page in a later phase.</p>}
              </div>
              <div className="config-control">
                <div className="config-effective"><span className="config-source">{entry.source === "db" ? "DB" : entry.source === "env" ? ".env" : "default"}</span><span>Effective: <code>{String(entry.value) || "(empty)"}</code></span></div>
                {entry.secret ? <input {...props} type="password" autoComplete="new-password" placeholder="Blank keeps the current secret" /> : entry.kind === "bool" ? <select {...props}><option value="true">Enabled</option><option value="false">Disabled</option></select> : entry.kind === "json" ? <textarea {...props} rows={3} /> : <input {...props} type={entry.kind === "int" ? "number" : entry.kind === "url" ? "url" : "text"} step={entry.kind === "int" ? 1 : undefined} />}
                <span id={`${entry.key}-help`} className="config-validation" role={message ? "alert" : undefined}>{message}</span>
                {entry.source === "db" && <button type="button" className="btn-secondary" onClick={() => void mutate(`/api/admin/config/${entry.key}`, "DELETE", `Reset ${entry.label}?`, `Remove the database override and use .env or the built-in default.${jwt(entry.key) ? " Everyone will be signed out." : ""}`)}>Reset to .env</button>}
              </div>
            </div>;
          })}
        </section>)}
      </fieldset>
      <SaveBar dirty={Object.keys(changes).length > 0} saving={busy} onDiscard={() => { form.discard(); setErrors({}); }} label="Apply changes" />
    </form>
    <section className="config-card"><h2>Bootstrap</h2><p>These values live in .env only. NEXT_PUBLIC_* values are fixed at build time. Database credentials and the encryption key are never displayed.</p><dl>{Object.entries(snapshot.bootstrap).map(([key, value]) => <div key={key}><dt><code>{key}</code></dt><dd>{value}</dd></div>)}</dl></section>
    </>}
    {view !== "settings" && <section className="config-card"><h2>History</h2><label htmlFor="config-history-filter">Filter by key</label><select id="config-history-filter" value={filter} onChange={(e) => { setFilter(e.target.value); setCursor(""); }}><option value="">All keys</option>{configRegistry.map((e) => <option key={e.key}>{e.key}</option>)}</select>
      {historyError && <p role="alert">{historyError}</p>}
      <div className="config-history"><table><thead><tr><th>Time / actor</th><th>Key / action</th><th>Old → new</th><th>Restore</th></tr></thead><tbody>{history.map((row) => <tr key={row.id}><td><time dateTime={row.at}>{new Date(row.at).toLocaleString()}</time><br />{row.actor}</td><td><code>{row.key}</code><br />{row.action}</td><td><code>{row.oldValue ?? "(unset)"} → {row.newValue ?? "(unset)"}</code></td><td><button type="button" className="btn-secondary" disabled={busy || !row.canRollback} title={row.reason} onClick={() => void mutate(`/api/admin/config/audit/${row.id}/rollback`, "POST", `Roll back ${row.key}?`, "Restore the effective value from before this change.")}>Roll back</button>{row.reason && <p>{row.reason}</p>}</td></tr>)}</tbody></table></div>
      {!history.length && !historyError && <p>No history yet.</p>}
      <div className="toolbar"><button type="button" disabled={!cursor} onClick={() => setCursor("")}>Newest</button><button type="button" disabled={!next} onClick={() => setCursor(next ?? "")}>Older</button></div>
    </section>}
  </div>;
}
