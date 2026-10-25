"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { useConfirm } from "./confirm-dialog";
import { useToast } from "./toast";

type Setting = { key: string; label: string; description: string; kind: "int" | "float"; min: number; max: number; value: number; default: number; overridden: boolean };
type Queue = { paused: boolean; waiting_extraction: number; extracting: number; caching: number; queue_limit: number };
type CdnFile = { id: string; name: string; size: number; views: number; date_upload: string; url: string };

const btn = "btn-secondary rounded-md border px-3 py-1.5 text-sm";

const scoped = (engine?: string) => (engine ? `?engine=${encodeURIComponent(engine)}` : "");

/** Queue status with pause/resume, and the editable settings of one engine (the primary when `engine` is not given). */
export function EvoControls({ engine }: { engine?: string }) {
  const toast = useToast();
  const q = scoped(engine);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const loadQueue = useCallback(async () => {
    const res = await adminApi<{ data: Queue }>("GET", `/api/admin/evo/queue${q}`);
    if (res.ok) setQueue(res.data);
  }, [q]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await adminApi<{ data: Setting[] }>("GET", `/api/admin/evo/config${q}`);
      if (!alive) return;
      if (!res.ok) return toast.error(errorText(res));
      setSettings(res.data);
    })();
    const poll = () => alive && loadQueue();
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [loadQueue, q, toast]);

  const setPaused = async (pause: boolean) => {
    setBusy(true);
    const res = await adminApi<{ data: Queue }>("POST", `/api/admin/evo/queue/${pause ? "pause" : "resume"}${q}`);
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    setQueue(res.data);
    toast.success(pause ? "Queue paused: running jobs finish, no new ones start" : "Queue resumed");
  };

  const save = async () => {
    const changes: Record<string, number> = {};
    for (const [k, v] of Object.entries(draft)) {
      const n = Number(v);
      if (v.trim() === "" || Number.isNaN(n)) return toast.error(`${k}: enter a number`);
      changes[k] = n;
    }
    setBusy(true);
    const res = await adminApi<{ data: Setting[] }>("PUT", `/api/admin/evo/config${q}`, changes);
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    setSettings(res.data);
    setDraft({});
    toast.success("Settings applied (no restart needed)");
  };

  const reset = async (key: string) => {
    setBusy(true);
    const res = await adminApi<{ data: Setting[] }>("DELETE", `/api/admin/evo/config/${key}${q}`);
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    setSettings(res.data);
    setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== key)));
    toast.success("Back to the .env value");
  };

  return (
    <>
      <h2 className="mt-6">Queue</h2>
      {queue ? (
        <div className="toolbar mt-2">
          <span className="text-sm">
            {queue.paused ? <strong>Paused</strong> : "Running"} · {queue.waiting_extraction} waiting · {queue.extracting} extracting · {queue.caching} caching to CDN · limit {queue.queue_limit}
          </span>
          <button type="button" className={btn} disabled={busy} onClick={() => setPaused(!queue.paused)}>
            {queue.paused ? "Resume" : "Pause"}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-sm">Engine unreachable.</p>
      )}

      <h2 className="mt-6">Engine settings</h2>
      {!settings ? (
        <div className="skeleton mt-2 h-32" aria-busy="true" />
      ) : (
        <>
          <div className="table-wrap mt-2">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Value</th>
                  <th>.env default</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {settings.map((s) => (
                  <tr key={s.key}>
                    <td>
                      <label htmlFor={s.key}>{s.label}</label>
                      <div className="text-xs">{s.description}</div>
                    </td>
                    <td>
                      <input
                        id={s.key}
                        type="number"
                        inputMode="decimal"
                        min={s.min}
                        max={s.max}
                        step={s.kind === "int" ? 1 : "any"}
                        value={draft[s.key] ?? String(s.value)}
                        onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                        style={{ width: "8rem" }}
                      />
                    </td>
                    <td>{s.default}</td>
                    <td>
                      {s.overridden && (
                        <button type="button" className={btn} disabled={busy} onClick={() => reset(s.key)}>
                          Reset
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar mt-3">
            <button type="button" disabled={busy || !Object.keys(draft).length} onClick={save}>
              Apply changes
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** Retry / cancel / remove buttons for one engine task row; with several engines a failed video task can also move. */
export function TaskActions({ id, status, cacheFailed, canMove = false }: { id: string; status: string; cacheFailed: boolean; canMove?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const running = ["PENDING", "EXTRACTING", "DOWNLOADING", "UPLOADING"].includes(status);

  const run = async (method: "POST" | "DELETE", path: string, done: string) => {
    setBusy(true);
    const res = await adminApi(method, path);
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    toast.success(done);
    router.refresh();
  };

  return (
    <div className="toolbar">
      {running && (
        <button type="button" className={btn} disabled={busy} onClick={() => run("POST", `/api/admin/evo/tasks/${id}/cancel`, "Task cancelled")}>
          Cancel
        </button>
      )}
      {canMove && (status === "FAILED" || cacheFailed || running) && (
        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={async () => {
            if (await confirm({ title: "Retry on another engine?", body: "A new job starts on a different healthy engine and extracts the title again. This task stays with its engine, and anyone watching it may be interrupted.", confirmLabel: "Retry elsewhere", danger: false })) {
              run("POST", `/api/admin/evo/tasks/${id}/move`, "Started on another engine");
            }
          }}
        >
          Retry elsewhere
        </button>
      )}
      {!running && (status === "FAILED" || cacheFailed) && (
        <button type="button" className={btn} disabled={busy} onClick={() => run("POST", `/api/admin/evo/tasks/${id}/retry`, "Task queued again")}>
          Retry
        </button>
      )}
      {!running && (
        <button
          type="button"
          className="btn-danger rounded-md border px-3 py-1.5 text-sm"
          disabled={busy}
          onClick={async () => {
            if (await confirm({ title: "Remove this task?", body: "Its history is deleted from the engine. Cached files and sources are not touched.", confirmLabel: "Remove" })) {
              run("DELETE", `/api/admin/evo/tasks/${id}`, "Task removed");
            }
          }}
        >
          Remove
        </button>
      )}
    </div>
  );
}

/** Deletes a cached source's file from the CDN and its catalog row. */
export function SourceDeleteButton({ sourceId, label, engine }: { sourceId: string; label: string; engine?: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn-danger rounded-md border px-3 py-1.5 text-sm"
      disabled={busy}
      onClick={async () => {
        if (!(await confirm({ title: `Delete the CDN file for ${label}?`, body: "The file is removed from the CDN and the source is deleted. The next play falls back to another quality or caches it again.", confirmLabel: "Delete file" }))) return;
        setBusy(true);
        const res = await adminApi("POST", `/api/admin/evo/cdn/delete${scoped(engine)}`, { sourceId });
        setBusy(false);
        if (!res.ok) return toast.error(errorText(res));
        toast.success("CDN file deleted");
        router.refresh();
      }}
    >
      Delete file
    </button>
  );
}

const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`);

/** Every file in the CDN account, with delete (also for orphans no source points at). */
export function CdnFiles({ engine }: { engine?: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [files, setFiles] = useState<CdnFile[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await adminApi<{ data: CdnFile[] }>("GET", `/api/admin/evo/cdn/files${scoped(engine)}`);
    if (res.ok) {
      setFiles(res.data);
      setError("");
    } else setError(errorText(res));
  }, [engine]);
  useEffect(() => {
    const t = setTimeout(load, 0); // deferred: load sets state
    return () => clearTimeout(t);
  }, [load]);

  if (error) return <p className="mt-2 text-sm">{error}</p>;
  if (!files) return <div className="skeleton mt-2 h-32" aria-busy="true" />;
  const total = files.reduce((n, f) => n + (f.size ?? 0), 0);
  return (
    <>
      <p className="mt-2 text-sm">
        {files.length} file(s) · {mb(total)}
      </p>
      <div className="table-wrap mt-2">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Views</th>
              <th>Uploaded</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td style={{ overflowWrap: "anywhere" }}>
                  <a href={f.url} target="_blank" rel="noreferrer">
                    {f.name}
                  </a>
                </td>
                <td>{mb(f.size ?? 0)}</td>
                <td>{f.views}</td>
                <td style={{ whiteSpace: "nowrap" }}>{f.date_upload ? new Date(f.date_upload).toLocaleString("en-GB", { timeZone: "UTC" }) : "—"}</td>
                <td>
                  <button
                    type="button"
                    className="btn-danger rounded-md border px-3 py-1.5 text-sm"
                    onClick={async () => {
                      if (!(await confirm({ title: `Delete ${f.name}?`, body: "The file is removed from the CDN. A catalog source pointing at it stops working until it is re-cached or removed.", confirmLabel: "Delete file" }))) return;
                      const res = await adminApi("POST", `/api/admin/evo/cdn/delete${scoped(engine)}`, { url: f.url });
                      if (!res.ok) return toast.error(errorText(res));
                      toast.success("CDN file deleted");
                      load();
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
