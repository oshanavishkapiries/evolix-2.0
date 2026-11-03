"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { EngineConfigPanel } from "./engine-config-panel";
import { useConfirm } from "./confirm-dialog";
import { useToast } from "./toast";

type Queue = { paused: boolean; waiting_extraction: number; extracting: number; caching: number; queue_limit: number };

const btn = "btn-secondary rounded-md border px-3 py-1.5 text-sm";
const small = "btn-secondary rounded-md border px-2 py-1 text-xs";

const scoped = (engine?: string) => (engine ? `?engine=${encodeURIComponent(engine)}` : "");

/** Polls one engine's queue (pause state and counts); null while unknown or unreachable. */
function useQueue(q: string, everyMs = 5000) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const load = useCallback(async () => {
    const res = await adminApi<{ data: Queue }>("GET", `/api/admin/evo/queue${q}`);
    setQueue(res.ok ? res.data : null);
    return res.ok;
  }, [q]);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(() => document.visibilityState === "visible" && load(), everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load, everyMs]);
  return [queue, setQueue, load] as const;
}

/** The engine page's header actions: pause/resume the queue, and a "More" menu with the actions that interrupt viewers. */
export function EngineActions({ engine, children }: { engine?: string; children?: React.ReactNode }) {
  const toast = useToast();
  const confirm = useConfirm();
  const q = scoped(engine);
  const [queue, setQueue, loadQueue] = useQueue(q);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const setPaused = async (pause: boolean) => {
    setBusy(true);
    const res = await adminApi<{ data: Queue }>("POST", `/api/admin/evo/queue/${pause ? "pause" : "resume"}${q}`);
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    setQueue(res.data);
    toast.success(pause ? "Queue paused: running jobs finish, no new ones start" : "Queue resumed");
  };

  const restart = async () => {
    setMenu(false);
    const busyNow = queue ? queue.waiting_extraction + queue.extracting + queue.caching : 0;
    const ok = await confirm({
      title: "Restart this engine?",
      body: (
        <>
          <p>The engine process stops and Docker starts it again, usually within a minute. Viewers who need it in that time see the &ldquo;busy&rdquo; message and retry by themselves.</p>
          {busyNow > 0 && <p><strong>{busyNow} job(s) are running or waiting and will be lost.</strong></p>}
          <p>It only comes back by itself if the container has a restart policy (compose.yaml has one; Coolify sets one by default).</p>
        </>
      ),
      confirmLabel: "Restart",
    });
    if (!ok) return;
    setBusy(true);
    const res = await adminApi("POST", `/api/admin/evo/restart${q ? `${q}&` : "?"}force=1`);
    if (!res.ok) {
      setBusy(false);
      return toast.error(errorText(res));
    }
    toast.success("Restarting…");
    // Wait until it answers again (it first has to stop answering).
    await new Promise((r) => setTimeout(r, 4000));
    for (let i = 0; i < 30; i++) {
      if (await loadQueue()) {
        setBusy(false);
        return toast.success("The engine is back");
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    setBusy(false);
    toast.error("The engine has not come back after 90 seconds. Check the container: it may have no restart policy.");
  };

  const clearSinhala = async () => {
    setMenu(false);
    const ok = await confirm({
      title: "Clear this engine's Sinhala cache?",
      body: "Every Sinhala subtitle it translated before is forgotten, so the next request translates again (with the model set under OpenRouter). Subtitles already saved on the CDN or in the catalog are not touched: remove those separately.",
      confirmLabel: "Clear cache",
    });
    if (!ok) return;
    setBusy(true);
    const res = await adminApi<{ data: { removed: number } }>("DELETE", `/api/admin/evo/sinhala-cache${q}`);
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res));
    toast.success(`${res.data.removed} cached translation(s) removed`);
  };

  return (
    <>
      {queue && (
        <button type="button" className={btn} disabled={busy} onClick={() => setPaused(!queue.paused)} title={queue.paused ? "Start taking new jobs again" : "Running jobs finish, no new ones start"}>
          {queue.paused ? "Resume queue" : "Pause queue"}
        </button>
      )}
      {children}
      <div className="menu" ref={menuRef}>
        <button type="button" className={btn} aria-haspopup="menu" aria-expanded={menu} disabled={busy} onClick={() => setMenu(!menu)}>
          More <span aria-hidden="true">▾</span>
        </button>
        {menu && (
          <div className="menu-pop" role="menu" aria-label="More engine actions">
            <p className="menu-label">Interrupts viewers</p>
            <button type="button" role="menuitem" onClick={restart}>
              Restart engine
              <small>Stops running jobs, back in about a minute</small>
            </button>
            <button type="button" role="menuitem" onClick={clearSinhala}>
              Clear Sinhala cache
              <small>Next Sinhala request translates again</small>
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** Live queue numbers of one engine, for its status tab. */
export function QueueStats({ engine }: { engine?: string }) {
  const [queue] = useQueue(scoped(engine), 3000);
  if (!queue) return <div className="skeleton h-16" aria-busy="true" />;
  const cells: [string, React.ReactNode][] = [
    ["Queue", queue.paused ? <span className="warn-text">Paused</span> : "Running"],
    ["Waiting", queue.waiting_extraction],
    ["Extracting", queue.extracting],
    ["Caching to CDN", queue.caching],
    ["Queue limit", queue.queue_limit],
  ];
  return (
    <dl className="stat-row" aria-label="Queue">
      {cells.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

/** DB-backed engine overrides, available even when the engine is offline. */
export function EngineSettings({engine}:{engine?:string}) { return <EngineConfigPanel engine={engine}/>; }

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
        <button type="button" className={small} disabled={busy} onClick={() => run("POST", `/api/admin/evo/tasks/${id}/cancel`, "Task cancelled")}>
          Cancel
        </button>
      )}
      {canMove && (status === "FAILED" || cacheFailed || running) && (
        <button
          type="button"
          className={small}
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
        <button type="button" className={small} disabled={busy} onClick={() => run("POST", `/api/admin/evo/tasks/${id}/retry`, "Task queued again")}>
          Retry
        </button>
      )}
      {!running && (
        <button
          type="button"
          className="btn-danger rounded-md border px-2 py-1 text-xs"
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
      className="btn-danger rounded-md border px-2 py-1 text-xs"
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
