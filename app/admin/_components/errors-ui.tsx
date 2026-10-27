"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ErrorFrame } from "@/db/schema";
import { reportError } from "@/lib/client/error-reporter";
import { adminApi, errorText } from "@/lib/client/admin";
import { useConfirm } from "./confirm-dialog";
import { useToast } from "./toast";

type Status = "unresolved" | "resolved" | "ignored";

export type IssueRow = {
  id: string;
  source: string;
  type: string;
  message: string;
  culprit: string;
  level: string;
  status: Status;
  count: number;
  users: number;
  firstSeen: string;
  lastSeen: string;
  spark: number[];
};

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
};

export function Sparkline({ values, width = 96, height = 24 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(...values, 0) || 1;
  const w = width / Math.max(values.length, 1);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="err-spark">
      {values.map((v, i) => {
        const h = v ? Math.max(2, (v / max) * height) : 1;
        return <rect key={i} x={i * w + 1} y={height - h} width={Math.max(1, w - 2)} height={h} rx={1} fill={v ? "var(--a-gold)" : "#3a3a3a"} />;
      })}
    </svg>
  );
}

function useBusyAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (label: string, call: () => Promise<{ ok: boolean; status: number }>, after?: () => void) => {
    setBusy(true);
    const res = await call();
    setBusy(false);
    if (!res.ok) return toast.error(errorText(res as never));
    toast.success(label);
    after?.();
    router.refresh();
  };
  return { busy, run };
}

/** Issue list with selection and bulk resolve / ignore / reopen / delete. */
export function IssueTable({ rows }: { rows: IssueRow[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const { busy, run } = useBusyAction();
  const confirm = useConfirm();
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const ids = [...sel];
  const setStatus = (status: Status) =>
    run(`${ids.length} issue${ids.length === 1 ? "" : "s"} ${status === "unresolved" ? "reopened" : status}`, () => adminApi("PATCH", "/api/admin/errors", { ids, status }), () => setSel(new Set()));
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${ids.length} issue${ids.length === 1 ? "" : "s"}?`, body: "Their events and history are deleted. If the error happens again it opens as a new issue.", confirmLabel: "Delete" }))) return;
    await run("Deleted", () => adminApi("DELETE", "/api/admin/errors", { ids }), () => setSel(new Set()));
  };

  return (
    <>
      <div className="err-bulk" data-active={sel.size > 0}>
        <label className="err-check">
          <input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all issues on this page" />
          <span>{sel.size ? `${sel.size} selected` : "Select"}</span>
        </label>
        {sel.size > 0 && (
          <span className="toolbar">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStatus("resolved")}>Resolve</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStatus("ignored")}>Ignore</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStatus("unresolved")}>Reopen</button>
            <button type="button" className="btn-danger" disabled={busy} onClick={remove}>Delete</button>
          </span>
        )}
      </div>
      <ul className="err-list">
        {rows.map((r) => (
          <li key={r.id} className="err-row" data-selected={sel.has(r.id)}>
            <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.type}: ${r.message}`} />
            <div className="err-main">
              <Link href={`/admin/errors/${r.id}`} className="err-title">
                <span className={`err-level err-level-${r.level}`} title={r.level} />
                <b>{r.type}</b>
                <span className="err-msg">{r.message}</span>
              </Link>
              <div className="err-meta">
                <span className={`err-src err-src-${r.source}`}>{r.source}</span>
                {r.status !== "unresolved" && <span className="err-status">{r.status}</span>}
                <code title={r.culprit}>{r.culprit || "—"}</code>
                <span title={new Date(r.firstSeen).toLocaleString()}>first {ago(r.firstSeen)}</span>
              </div>
            </div>
            <Sparkline values={r.spark} />
            <div className="err-num"><b>{r.count.toLocaleString()}</b><small>events</small></div>
            <div className="err-num"><b>{r.users}</b><small>users</small></div>
            <div className="err-num err-when"><b>{ago(r.lastSeen)}</b><small>last seen</small></div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Resolve / ignore / reopen / delete for one issue. */
export function IssueActions({ id, status }: { id: string; status: Status }) {
  const { busy, run } = useBusyAction();
  const router = useRouter();
  const confirm = useConfirm();
  const set = (s: Status) => run(s === "unresolved" ? "Reopened" : s === "resolved" ? "Resolved" : "Ignored", () => adminApi("PATCH", "/api/admin/errors", { ids: [id], status: s }));
  const remove = async () => {
    if (!(await confirm({ title: "Delete this issue?", body: "All its events and history are deleted. If it happens again it opens as a new issue.", confirmLabel: "Delete" }))) return;
    await run("Issue deleted", () => adminApi("DELETE", "/api/admin/errors", { ids: [id] }), () => router.push("/admin/errors"));
  };
  return (
    <>
      {status === "unresolved" ? (
        <>
          <button type="button" disabled={busy} onClick={() => set("resolved")} title="Mark fixed. If it happens again it reopens and alerts as a regression.">Resolve</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => set("ignored")} title="Keep counting, but hide it and never alert.">Ignore</button>
        </>
      ) : (
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => set("unresolved")}>Reopen</button>
      )}
      <button type="button" className="btn-danger" disabled={busy} onClick={remove}>Delete</button>
    </>
  );
}

class EvolixTestError extends Error {
  name = "EvolixTestError";
}

/** Fires a server and/or browser test error through the real capture paths. */
export function TestErrorButtons() {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const server = async () => {
    setBusy(true);
    await adminApi("POST", "/api/admin/errors/test");
    setBusy(false);
    toast.success("Server test error sent");
    setTimeout(() => router.refresh(), 800);
  };
  const client = () => {
    reportError(new EvolixTestError("Test error from the admin panel (browser)"), { mechanism: "test button" });
    toast.success("Browser test error sent");
    setTimeout(() => router.refresh(), 1200);
  };
  return (
    <>
      <button type="button" className="btn-secondary" disabled={busy} onClick={server}>Test server error</button>
      <button type="button" className="btn-secondary" onClick={client}>Test browser error</button>
    </>
  );
}

/** Stack trace: in-app frames open with source context; framework frames collapse behind a toggle. */
export function StackTrace({ frames, raw }: { frames: ErrorFrame[]; raw: string }) {
  const [all, setAll] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const hasApp = frames.some((f) => f.inApp);
  const shown = all || !hasApp ? frames : frames.filter((f) => f.inApp);
  const hidden = frames.length - shown.length;
  return (
    <div className="err-stack">
      <div className="err-stack-bar">
        <span className="text-sm">{frames.length} frames{hasApp ? `, ${frames.filter((f) => f.inApp).length} in app` : ""}</span>
        <span className="toolbar">
          {!all && hidden > 0 && <button type="button" className="btn-secondary" onClick={() => setAll(true)}>Show all frames ({hidden} more)</button>}
          {all && hasApp && <button type="button" className="btn-secondary" onClick={() => setAll(false)}>App frames only</button>}
          <button type="button" className="btn-secondary" onClick={() => setShowRaw((v) => !v)}>{showRaw ? "Parsed" : "Raw"}</button>
        </span>
      </div>
      {showRaw || frames.length === 0 ? (
        <pre className="err-raw">{raw || "No stack trace was captured."}</pre>
      ) : (
        <ol className="err-frames">
          {shown.map((f, i) => (
            <li key={i} data-app={f.inApp}>
              <details open={f.inApp && i < 3}>
                <summary>
                  <code className="err-file">{f.file}{f.line ? `:${f.line}` : ""}{f.col ? `:${f.col}` : ""}</code>
                  <span className="err-fn">in {f.fn}</span>
                </summary>
                {f.context ? (
                  <pre className="err-code">
                    {f.context.lines.map((l, j) => {
                      const n = f.context!.start + j;
                      return (
                        <span key={n} data-hit={n === f.line}>
                          <i>{n}</i>
                          {l || " "}
                          {"\n"}
                        </span>
                      );
                    })}
                  </pre>
                ) : (
                  <p className="err-nocode">No source available for this frame.</p>
                )}
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Copies a Markdown summary (error, location, stack, context) to paste into a ticket or an AI assistant. */
export function CopyIssue({ markdown }: { markdown: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(markdown);
          toast.success("Copied as Markdown");
        } catch {
          toast.error("Clipboard is not available");
        }
      }}
    >
      Copy for fix
    </button>
  );
}
