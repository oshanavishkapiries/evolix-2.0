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

/** Queue status with pause/resume, and the editable engine settings. */
export function EvoControls() {
  const toast = useToast();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const loadQueue = useCallback(async () => {
    const res = await adminApi<{ data: Queue }>("GET", "/api/admin/evo/queue");
    if (res.ok) setQueue(res.data);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await adminApi<{ data: Setting[] }>("GET", "/api/admin/evo/config");
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
  }, [loadQueue, toast]);

  const setPaused = async (pause: boolean) => {
    setBusy(true);
    const res = await adminApi<{ data: Queue }>("POST", `/api/admin/evo/queue/${pause ? "pause" : "resume"}`);
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
    const res = await adminApi<{ data: Setting[] }>("PUT", "/api/admin/evo/config", changes);
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    setSettings(res.data);
    setDraft({});
    toast.success("Settings applied (no restart needed)");
  };

  const reset = async (key: string) => {
    setBusy(true);
    const res = await adminApi<{ data: Setting[] }>("DELETE", `/api/admin/evo/config/${key}`);
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

/** Retry / cancel / remove buttons for one engine task row. */
export function TaskActions({ id, status, cacheFailed }: { id: string; status: string; cacheFailed: boolean }) {
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
export function SourceDeleteButton({ sourceId, label }: { sourceId: string; label: string }) {
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
        const res = await adminApi("POST", "/api/admin/evo/cdn/delete", { sourceId });
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
export function CdnFiles() {
  const toast = useToast();
  const confirm = useConfirm();
  const [files, setFiles] = useState<CdnFile[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await adminApi<{ data: CdnFile[] }>("GET", "/api/admin/evo/cdn/files");
    if (res.ok) {
      setFiles(res.data);
      setError("");
    } else setError(errorText(res));
  }, []);
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
                      const res = await adminApi("POST", "/api/admin/evo/cdn/delete", { url: f.url });
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
