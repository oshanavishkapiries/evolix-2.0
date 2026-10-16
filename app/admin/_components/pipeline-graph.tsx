"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import { EDGES, NODES, NODE_H, NODE_W, STEP_IDS, VIEW_H, VIEW_W, edgeState, foldEvents, formatDuration, parseTs, type FlowEvent, type StepId, type StepState, type StepView, type Summary } from "@/lib/evo/flow";

type NodeView = { state: StepState; sub: string };

const clip = (t: string, n = 24) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const nodeById = Object.fromEntries(NODES.map((n) => [n.id, n])) as Record<StepId, (typeof NODES)[number]>;

/** Cubic bezier between two nodes: sideways inside a row, top-to-bottom for the wrap into the second row. */
function edgePath(from: StepId, to: StepId) {
  const a = nodeById[from];
  const b = nodeById[to];
  if (a.y === b.y && b.x - a.x > NODE_W * 2) {
    // Same row but not adjacent (subtitles -> translate): arc over the nodes in between.
    const x1 = a.x + NODE_W / 2;
    const x2 = b.x + NODE_W / 2;
    return `M ${x1} ${a.y} C ${x1} ${a.y - 40}, ${x2} ${a.y - 40}, ${x2} ${a.y}`;
  }
  if (a.y === b.y) {
    const x1 = a.x + NODE_W;
    const y = a.y + NODE_H / 2;
    return `M ${x1} ${y} C ${x1 + 22} ${y}, ${b.x - 22} ${y}, ${b.x} ${y}`;
  }
  const x1 = a.x + NODE_W / 2;
  const y1 = a.y + NODE_H;
  const x2 = b.x + NODE_W / 2;
  return `M ${x1} ${y1} C ${x1} ${y1 + 52}, ${x2} ${b.y - 52}, ${x2} ${b.y}`;
}

function Canvas({ views, edges, selected, onSelect }: { views: Record<StepId, NodeView>; edges: Record<string, string>; selected: StepId | null; onSelect: (id: StepId) => void }) {
  return (
    <div className="flow-scroll">
      <svg className="flow-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="group" aria-label="Evo engine pipeline">
        {EDGES.map((e) => (
          <path key={`${e.from}-${e.to}`} d={edgePath(e.from, e.to)} className="flow-edge" data-state={edges[`${e.from}-${e.to}`]} />
        ))}
        {NODES.map((n) => {
          const v = views[n.id];
          return (
            <g
              key={n.id}
              className="flow-node"
              data-state={v.state}
              data-selected={selected === n.id}
              transform={`translate(${n.x} ${n.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${n.label}: ${v.state}`}
              onClick={() => onSelect(n.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(n.id))}
            >
              <rect className="flow-box" width={NODE_W} height={NODE_H} rx={10} />
              <circle className="flow-port" cx={0} cy={NODE_H / 2} r={4} />
              <circle className="flow-port" cx={NODE_W} cy={NODE_H / 2} r={4} />
              <circle className="flow-dot" cx={NODE_W - 16} cy={16} r={5} />
              <text className="flow-title" x={14} y={26}>{n.label}</text>
              <text className="flow-sub" x={14} y={46}>{clip(v.sub || n.hint)}</text>
              <text className="flow-state" x={14} y={63}>{v.state}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const Legend = () => (
  <ul className="flow-legend" aria-label="Legend">
    {(["pending", "running", "ok", "skipped", "failed"] as StepState[]).map((s) => (
      <li key={s}><span className="flow-key" data-state={s} />{s}</li>
    ))}
  </ul>
);

export type TaskInfo = { status: string; message: string; cache_failed?: boolean };
const terminal = (t: TaskInfo) => t.status === "COMPLETED" || t.status === "FAILED" || Boolean(t.cache_failed);

/** One task's journey through the pipeline. Polls the engine until the task settles. */
export function TaskFlow({ taskId, initial }: { taskId: string; initial: { task: TaskInfo; events: FlowEvent[] } }) {
  const [data, setData] = useState(initial);
  const [selected, setSelected] = useState<StepId | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [watching, setWatching] = useState(false);
  const [note, setNote] = useState("");
  const done = terminal(data.task);
  const folded = useMemo(() => foldEvents(data.events), [data.events]);
  const busy = (["translate", "subtitle_sync", "webhook"] as StepId[]).some((id) => folded[id].state === "running");

  useEffect(() => {
    if (done && !watching) return;
    let live = true;
    let polls = 0;
    const tick = setInterval(async () => {
      polls++;
      const res = await fetchWithRefresh(`/api/admin/evo/tasks/${taskId}`, { cache: "no-store" }).catch(() => null);
      const body = res?.ok ? await res.json() : null;
      if (live && body?.task) setData({ task: body.task, events: body.events ?? [] });
      // Give a manually started translation a couple of polls to show up, then stop once it settles.
      if (live && watching && polls >= 3 && body && !(["translate", "subtitle_sync", "webhook"] as StepId[]).some((id) => foldEvents(body.events ?? [])[id].state === "running")) setWatching(false);
    }, 2000);
    return () => {
      live = false;
      clearInterval(tick);
    };
  }, [taskId, done, watching]);

  async function translate() {
    setNote("Asking the engine…");
    const res = await fetchWithRefresh(`/api/admin/evo/tasks/${taskId}/translate`, { method: "POST" }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (res?.ok) {
      setNote("Translation queued: watch the Sinhala subtitles node.");
      setWatching(true);
    } else setNote(body?.message ?? "Could not start the translation");
  }
  const running = STEP_IDS.some((id) => folded[id].state === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const views = Object.fromEntries(
    STEP_IDS.map((id) => {
      const v = folded[id];
      let sub = v.detail;
      if (v.state === "running" && v.startedAt) sub = `${formatDuration(now - v.startedAt)} · ${v.detail}`;
      else if (v.startedAt && v.endedAt && v.endedAt - v.startedAt >= 1000) sub = `${formatDuration(v.endedAt - v.startedAt)} · ${v.detail}`;
      return [id, { state: v.state, sub }];
    }),
  ) as Record<StepId, NodeView>;
  const edges = Object.fromEntries(EDGES.map((e) => [`${e.from}-${e.to}`, edgeState(folded[e.to])]));
  const sel = selected ? folded[selected] : null;

  return (
    <>
      <Canvas views={views} edges={edges} selected={selected} onSelect={setSelected} />
      <Legend />
      <p className="flow-status" role="status">
        <strong>{data.task.status}</strong> — {data.task.message}
        {(!done || watching) && <span className="flow-live"> · live</span>}
      </p>
      {data.task.status === "COMPLETED" && (
        <p className="flow-actions">
          <button type="button" className="btn-secondary" disabled={busy || watching} onClick={translate}>
            {folded.translate.state === "ok" ? "Re-run Sinhala subtitles" : "Translate subtitles to Sinhala"}
          </button>
          {note && <span className="flow-hint"> {note}</span>}
        </p>
      )}
      <StepLog id={selected} view={sel} />
    </>
  );
}

function StepLog({ id, view }: { id: StepId | null; view: StepView | null }) {
  if (!id || !view) return <p className="flow-hint">Click a node to see its events.</p>;
  const node = nodeById[id];
  return (
    <div className="flow-log">
      <h3>{node.label}</h3>
      {!view.events.length ? (
        <p className="flow-hint">Nothing happened here (yet).</p>
      ) : (
        <ul>
          {view.events.map((e, i) => (
            <li key={i}>
              <time dateTime={e.ts}>{new Date(parseTs(e.ts)).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC</time>
              <span className="flow-pill" data-state={e.state}>{e.state}</span>
              <span>{e.detail || "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Whole-pipeline view: how many tasks last ended in each state per step, refreshed every few seconds. */
export function SummaryFlow({ initial }: { initial: Summary | null }) {
  const [summary, setSummary] = useState(initial);
  const [selected, setSelected] = useState<StepId | null>(null);

  useEffect(() => {
    let live = true;
    const tick = setInterval(async () => {
      const res = await fetchWithRefresh("/api/admin/evo/summary", { cache: "no-store" }).catch(() => null);
      const body = res?.ok ? await res.json() : null;
      if (live && body?.summary) setSummary(body.summary);
    }, 5000);
    return () => {
      live = false;
      clearInterval(tick);
    };
  }, []);

  const views = Object.fromEntries(
    STEP_IDS.map((id) => {
      const c = summary?.steps[id] ?? { ok: 0, failed: 0, running: 0, skipped: 0 };
      const state: StepState = c.running > 0 ? "running" : c.failed > 0 ? "failed" : c.ok > 0 ? "ok" : c.skipped > 0 ? "skipped" : "pending";
      return [id, { state, sub: `✓ ${c.ok}  ✗ ${c.failed}  ⟳ ${c.running}  ↷ ${c.skipped}` }];
    }),
  ) as Record<StepId, NodeView>;
  const edges = Object.fromEntries(EDGES.map((e) => [`${e.from}-${e.to}`, views[e.to].state === "running" ? "active" : views[e.to].state === "pending" ? "idle" : "done"]));
  const c = selected ? summary?.steps[selected] : null;

  return (
    <>
      <Canvas views={views} edges={edges} selected={selected} onSelect={setSelected} />
      <Legend />
      <p className="flow-status" role="status">
        Last {summary?.window_hours ?? 24}h · {summary?.tasks_in_flight ?? 0} task(s) in flight
        {!summary && " · engine offline"}
      </p>
      {selected ? (
        <div className="flow-log">
          <h3>{nodeById[selected].label}</h3>
          <p className="flow-hint">
            {c ? `${c.ok} succeeded, ${c.failed} failed, ${c.running} running, ${c.skipped} skipped` : "No activity in this window."} Open a task below for its own journey.
          </p>
        </div>
      ) : (
        <p className="flow-hint">Click a node for its numbers.</p>
      )}
    </>
  );
}
