/** Pipeline model shared by the engine events and the admin flow view (pure, client-safe). */

export const STEP_IDS = ["request", "extract", "resolve", "subtitles", "stream", "cdn_check", "download", "verify", "upload", "subtitle_sync", "webhook", "translate"] as const;
export type StepId = (typeof STEP_IDS)[number];
export type StepState = "pending" | "running" | "ok" | "failed" | "skipped";

export type FlowEvent = { step: string; state: string; detail: string; ts: string };
export type StepView = { state: StepState; detail: string; startedAt: number | null; endedAt: number | null; events: FlowEvent[] };

export const NODE_W = 168;
export const NODE_H = 72;
const COL = 208;
const X0 = 16;
const ROW1 = 44;
const ROW2 = 196;

export const NODES: { id: StepId; label: string; hint: string; x: number; y: number }[] = [
  { id: "request", label: "Request", hint: "Viewer asks to play", x: X0, y: ROW1 },
  { id: "extract", label: "Extract streams", hint: "Decrypt provider HLS", x: X0 + COL, y: ROW1 },
  { id: "resolve", label: "Pick quality", hint: "Requested or fallback", x: X0 + COL * 2, y: ROW1 },
  { id: "subtitles", label: "Find subtitles", hint: "OpenSubtitles, 10 langs", x: X0 + COL * 3, y: ROW1 },
  { id: "stream", label: "Stream ready", hint: "Instant HLS playback", x: X0 + COL * 4, y: ROW1 },
  { id: "cdn_check", label: "CDN check", hint: "Reuse or cache", x: X0, y: ROW2 },
  { id: "download", label: "Download", hint: "ffmpeg remux to MP4", x: X0 + COL, y: ROW2 },
  { id: "verify", label: "Verify", hint: "Size and duration", x: X0 + COL * 2, y: ROW2 },
  { id: "upload", label: "Upload video", hint: "Pixeldrain CDN", x: X0 + COL * 3, y: ROW2 },
  { id: "subtitle_sync", label: "Sync subtitles", hint: "Re-host on the CDN", x: X0 + COL * 4, y: ROW2 },
  { id: "webhook", label: "Register in app", hint: "Source row in the DB", x: X0 + COL * 5, y: ROW2 },
  { id: "translate", label: "Sinhala subtitles", hint: "AI translation (async)", x: X0 + COL * 5, y: ROW1 },
];
export const VIEW_W = X0 * 2 + COL * 5 + NODE_W;
export const VIEW_H = ROW2 + NODE_H + 24;

const MAIN = STEP_IDS.filter((id) => id !== "translate");
/** The main chain, plus the translation branch (subtitles -> translate -> subtitle sync). */
export const EDGES: { from: StepId; to: StepId }[] = [
  ...MAIN.slice(1).map((to, i) => ({ from: MAIN[i], to })),
  { from: "subtitles", to: "translate" },
  { from: "translate", to: "subtitle_sync" },
];

/** Engine timestamps are naive UTC ISO strings. */
export const parseTs = (ts: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`);

const known = new Set<string>(STEP_IDS);

/** Collapses an event stream into one view per step (latest state wins, first "running" is the start). */
export function foldEvents(events: FlowEvent[]): Record<StepId, StepView> {
  const out = Object.fromEntries(STEP_IDS.map((id) => [id, { state: "pending", detail: "", startedAt: null, endedAt: null, events: [] } as StepView])) as Record<StepId, StepView>;
  for (const e of events) {
    if (!known.has(e.step)) continue;
    const view = out[e.step as StepId];
    const at = parseTs(e.ts);
    view.events.push(e);
    view.state = (["running", "ok", "failed", "skipped"].includes(e.state) ? e.state : "pending") as StepState;
    view.detail = e.detail;
    if (e.state === "running" && view.startedAt === null) view.startedAt = at;
    if (e.state !== "running") {
      view.startedAt ??= at;
      view.endedAt = at;
    }
  }
  return out;
}

export type EdgeState = "idle" | "active" | "done" | "failed";

/** Edge lights up while data flows into a running step, stays lit once the step has begun. */
export function edgeState(to: StepView): EdgeState {
  if (to.state === "running") return "active";
  if (to.state === "failed") return "failed";
  if (to.state === "ok" || to.state === "skipped") return "done";
  return "idle";
}

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export type Summary = { window_hours: number; steps: Partial<Record<StepId, { ok: number; failed: number; running: number; skipped: number }>>; tasks_in_flight: number };
