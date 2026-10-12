import { isCueActive, type TextTrack } from "@vidstack/react";

/**
 * Per-subtitle timing correction: shown = scale * original + offset (seconds).
 * Anchors are the dialogue-sync points the viewer set (original cue start -> video time); two far
 * apart also fix speed drift, e.g. a 25fps subtitle on a 23.976fps video.
 */
export type SubTiming = { scale: number; offset: number; anchors: { o: number; t: number }[] };
export type Cue = TextTrack["cues"][number];

export const NO_TIMING: SubTiming = { scale: 1, offset: 0, anchors: [] };
const KEY = "v-sub-timing";
const MAX_SAVED = 200;
/** Anchors closer than this replace each other: re-syncing the same scene is a correction. */
const SAME_SCENE_S = 30;
/** Two anchors must be this far apart before they are trusted to estimate drift. */
const DRIFT_SPAN_S = 60;
/** Real frame-rate mismatches stay within a few percent; anything wider is a mis-pick. */
const MAX_DRIFT = 0.15;

export const isNoTiming = (t: SubTiming) => t.scale === 1 && t.offset === 0;

type Saved = Record<string, SubTiming & { at: number }>;
function readAll(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function loadTiming(id: string): SubTiming {
  const t = readAll()[id];
  if (!t || !Number.isFinite(t.scale) || !Number.isFinite(t.offset)) return NO_TIMING;
  return { scale: t.scale, offset: t.offset, anchors: Array.isArray(t.anchors) ? t.anchors : [] };
}

export function saveTiming(id: string, timing: SubTiming) {
  const all = readAll();
  if (isNoTiming(timing)) delete all[id];
  else all[id] = { ...timing, at: Date.now() };
  // Keep the most recently synced subtitles only.
  const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_SAVED);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {}
}

/** Original cue times, so corrections never compound. */
const originals = new WeakMap<Cue, { s: number; e: number }>();
export const originalStart = (cue: Cue) => originals.get(cue)?.s ?? cue.startTime;

/** Shifts every cue of a loaded track to the given timing (in place: Vidstack renders these cues). */
export function applyTiming(track: TextTrack, timing: SubTiming, now: number) {
  for (const cue of track.cues) {
    let o = originals.get(cue);
    if (!o) originals.set(cue, (o = { s: cue.startTime, e: cue.endTime }));
    cue.startTime = Math.max(0, timing.scale * o.s + timing.offset);
    cue.endTime = Math.max(0, timing.scale * o.e + timing.offset);
  }
  refreshActive(track, now);
}

/**
 * Vidstack recomputes the on-screen cues only on time updates, so a paused video would keep the
 * old line. Removing and re-adding a cue makes the track recompute them right away.
 */
function refreshActive(track: TextTrack, now: number) {
  const stale = track.activeCues[0];
  const fresh = track.cues.find((c) => isCueActive(c, now));
  for (const cue of new Set([stale, fresh])) {
    if (!cue) continue;
    track.removeCue(cue);
    track.addCue(cue);
  }
}

/** Timing that shows the cue originally at `o` seconds exactly at video time `t`. */
export function syncAt(prev: SubTiming, o: number, t: number): SubTiming {
  const anchors = [...prev.anchors.filter((a) => Math.abs(a.o - o) >= SAME_SCENE_S), { o, t }].slice(-2);
  if (anchors.length === 2) {
    const [a, b] = anchors;
    const scale = (b.t - a.t) / (b.o - a.o);
    if (Math.abs(b.o - a.o) >= DRIFT_SPAN_S && Math.abs(scale - 1) <= MAX_DRIFT) {
      return { scale, offset: b.t - scale * b.o, anchors };
    }
  }
  return { scale: 1, offset: t - o, anchors: [{ o, t }] };
}

/** Moves every line by `d` seconds (positive = later). */
export const nudge = (prev: SubTiming, d: number): SubTiming => ({
  scale: prev.scale,
  offset: prev.offset + d,
  anchors: prev.anchors.map((a) => ({ o: a.o, t: a.t + d })),
});

export function formatClock(s: number) {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export const formatShift = (s: number) => `${s >= 0 ? "+" : "−"}${Math.abs(s).toFixed(2)}s`;

/** Cue text without VTT/SRT markup (<i>, <b>, {\an8}, voice tags). */
export const cueText = (cue: Cue) =>
  cue.text.replace(/<[^>]*>/g, "").replace(/\{\\[^}]*\}/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
