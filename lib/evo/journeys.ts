import { parseTs, STEP_IDS, type StepId, type Summary } from "./flow";

/**
 * What a viewer went through for one title, not one engine task at a time. A retry makes a new task, so looking at
 * tasks shows every failure on the way to a success; a journey says whether they finally got to watch.
 * Pure and client-safe. The engine reports the facts (lib/evo/overview.ts fetches them); the verdict is here.
 */
export type JourneyTask = {
  task_id: string;
  quality: string;
  resolved_quality: string | null;
  status: string;
  cache_failed: boolean;
  message: string;
  created_at: string;
  updated_at: string;
  /** When the viewer could start watching (null if they never could). */
  ready_at: string | null;
  watchable: boolean;
  steps: Record<string, string>;
  failed_step: string | null;
  failed_detail: string;
};

export type EngineJourney = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  season: number | null;
  episode: number | null;
  kind: "video" | "sinhala";
  title: string | null;
  tasks: JourneyTask[];
};

export type OwnedTask = JourneyTask & { engineId: string; engineName: string };

/**
 * smooth    watched on the first try without a long wait
 * struggled watched in the end, but after failed tries or a long wait
 * never     no try worked: the viewer is stuck (or gave up)
 * trying    the latest try is still running
 */
export type Outcome = "smooth" | "struggled" | "never" | "trying";
export const OUTCOMES: Outcome[] = ["never", "trying", "struggled", "smooth"];

/** The two windows the admin offers (hours): 24 hours and 7 days. */
export const JOURNEY_WINDOWS = [24, 168] as const;

/** Longer than this from the first try to "stream ready" is not a smooth watch. */
export const SMOOTH_WAIT_S = 60;
const ACTIVE = new Set(["PENDING", "EXTRACTING", "DOWNLOADING", "UPLOADING"]);

export type Trouble = { step: string | null; detail: string };

export type Journey = {
  id: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  season: number | null;
  episode: number | null;
  kind: "video" | "sinhala";
  title: string | null;
  /** Every try, oldest first, each tagged with the engine that ran it. */
  tasks: OwnedTask[];
  outcome: Outcome;
  tries: number;
  /** Seconds from the first try to "stream ready" (null when they never got to watch). */
  waitSeconds: number | null;
  startedAt: string;
  lastAt: string;
  /** The try that decides the outcome: the one that worked, else the latest. */
  decisive: OwnedTask;
  /** What went wrong on the way (the failed try before the success, or the one that ended it). */
  trouble: Trouble | null;
  /** Steps where an earlier try failed although the viewer got there in the end. */
  recoveredSteps: string[];
};

type Part = { engineId: string; engineName: string; journeys: EngineJourney[] };

const keyOf = (j: EngineJourney) => `${j.kind}:${j.media_type}:${j.tmdb_id}:${j.season ?? 0}:${j.episode ?? 0}`;
const byCreated = (a: JourneyTask, b: JourneyTask) => a.created_at.localeCompare(b.created_at);

/** Joins the journeys of several engines: a retry on another engine is still one journey. Worst trouble first. */
export function mergeJourneys(parts: Part[]): Journey[] {
  const groups = new Map<string, { head: EngineJourney; tasks: OwnedTask[] }>();
  for (const p of parts) {
    for (const j of p.journeys) {
      const g = groups.get(keyOf(j)) ?? { head: j, tasks: [] };
      g.tasks.push(...j.tasks.map((t) => ({ ...t, engineId: p.engineId, engineName: p.engineName })));
      if (j.title) g.head = { ...g.head, title: j.title };
      groups.set(keyOf(j), g);
    }
  }
  const rank = Object.fromEntries(OUTCOMES.map((o, i) => [o, i]));
  return [...groups.entries()]
    .map(([id, g]) => settle(id, g.head, g.tasks))
    .filter((j): j is Journey => j !== null)
    .sort((a, b) => rank[a.outcome] - rank[b.outcome] || b.lastAt.localeCompare(a.lastAt));
}

export function settle(id: string, head: EngineJourney, all: OwnedTask[]): Journey | null {
  const tasks = [...all].sort(byCreated);
  if (!tasks.length) return null;
  const win = tasks.findIndex((t) => t.watchable);
  const base = { id, tmdbId: head.tmdb_id, mediaType: head.media_type, season: head.season, episode: head.episode, kind: head.kind, title: head.title, tasks, startedAt: tasks[0].created_at, lastAt: tasks.reduce((m, t) => (t.updated_at > m ? t.updated_at : m), tasks[0].updated_at) };

  if (win >= 0) {
    const decisive = tasks[win];
    const waitSeconds = Math.max(0, Math.round((parseTs(decisive.ready_at ?? decisive.updated_at) - parseTs(tasks[0].created_at)) / 1000));
    const tries = win + 1;
    const before = tasks.slice(0, win);
    const lastBad = [...before].reverse().find((t) => t.failed_step || t.status === "FAILED");
    const recoveredSteps = [...new Set(before.map((t) => t.failed_step).filter((s): s is string => !!s))];
    const smooth = tries === 1 && waitSeconds <= SMOOTH_WAIT_S;
    const trouble: Trouble | null = lastBad ? { step: lastBad.failed_step, detail: lastBad.failed_detail || lastBad.message } : smooth ? null : { step: null, detail: `Took ${waitSeconds}s to become watchable` };
    return { ...base, decisive, tries, waitSeconds, recoveredSteps, outcome: smooth ? "smooth" : "struggled", trouble };
  }
  const decisive = tasks[tasks.length - 1];
  return {
    ...base, decisive, tries: tasks.length, waitSeconds: null, recoveredSteps: [],
    outcome: ACTIVE.has(decisive.status) ? "trying" : "never",
    trouble: { step: decisive.failed_step, detail: decisive.failed_detail || decisive.message },
  };
}

type Cell = { ok: number; failed: number; running: number; skipped: number; recovered: number };
export type JourneyReport = {
  hours: number;
  totals: Record<Outcome, number>;
  /** Median seconds to "stream ready" over journeys that ended in a watch (null when there are none). */
  medianWaitSeconds: number | null;
  summary: Summary;
  journeys: Journey[];
  /** Engines whose journeys could not be read (offline, or not updated to the version that reports them). */
  unreachable: string[];
  truncated: boolean;
};

/**
 * The pipeline graph by final outcome: each journey counts once, by the try that decided it. `recovered` counts
 * journeys where an earlier try failed at that step and the viewer still got through.
 */
export function summarize(journeys: Journey[], hours: number, extra: { unreachable?: string[]; truncated?: boolean } = {}): JourneyReport {
  const totals: Record<Outcome, number> = { smooth: 0, struggled: 0, never: 0, trying: 0 };
  const steps: Partial<Record<StepId, Cell>> = {};
  const waits: number[] = [];
  for (const j of journeys) {
    totals[j.outcome]++;
    if (j.waitSeconds !== null) waits.push(j.waitSeconds);
    for (const id of STEP_IDS) {
      const state = j.decisive.steps[id];
      const recovered = j.recoveredSteps.includes(id);
      if (!state && !recovered) continue;
      const cell = (steps[id] ??= { ok: 0, failed: 0, running: 0, skipped: 0, recovered: 0 });
      if (state === "ok" || state === "failed" || state === "running" || state === "skipped") cell[state]++;
      if (recovered) cell.recovered++;
    }
  }
  waits.sort((a, b) => a - b);
  const medianWaitSeconds = waits.length ? waits[Math.floor((waits.length - 1) / 2)] : null;
  return { hours, totals, medianWaitSeconds, summary: { window_hours: hours, steps, tasks_in_flight: totals.trying }, journeys, unreachable: extra.unreachable ?? [], truncated: extra.truncated ?? false };
}

export const OUTCOME_TEXT: Record<Outcome, { label: string; hint: string }> = {
  smooth: { label: "Watched smoothly", hint: "Worked on the first try, without a long wait" },
  struggled: { label: "Watched after trouble", hint: "Got there in the end, after failed tries or a long wait" },
  never: { label: "Never got it", hint: "No try worked: the viewer is stuck or gave up" },
  trying: { label: "Still trying", hint: "The latest try is still running" },
};

export function waitText(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
