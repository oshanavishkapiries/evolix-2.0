import type { EngineTask } from "@/lib/cms/evo";
import type { Summary } from "./flow";
import { engineGet, engines, type EngineRef } from "./client";
import { engineRows } from "./scheduler";

export type EngineOverview = {
  id: string;
  name: string;
  url: string;
  /** Answered its latest health check. */
  available: boolean;
  draining: boolean;
  lastOkAt: Date | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  activeJobs: number;
  queueDepth: number;
  freeDiskGb: number | null;
  /** Recent tasks that failed or were not cached (looked at the last 100 tasks the engine reports). */
  failures: number | null;
  /** Draining and nothing left to finish: nothing is lost by removing it from EVO_ENGINES. */
  safeToRemove: boolean;
};

const FAILED = (t: EngineTask) => t.status === "FAILED" || t.cache_failed;

/** Every configured engine with its last known numbers; unreachable ones keep their last data and time. */
export async function enginesOverview(): Promise<EngineOverview[]> {
  const rows = await engineRows();
  return Promise.all(
    rows.map(async (r) => {
      const tasks = r.healthy ? await engineGet<EngineTask[]>("/tasks?limit=100", 4000, r.ref) : null;
      return {
        id: r.id,
        name: r.ref.name,
        url: r.url,
        available: r.healthy,
        draining: r.draining,
        lastOkAt: r.lastOkAt,
        lastCheckedAt: r.lastCheckedAt,
        lastError: r.lastError,
        activeJobs: r.activeJobs,
        queueDepth: r.queueDepth,
        freeDiskGb: r.freeDiskGb,
        failures: tasks ? tasks.filter(FAILED).length : null,
        safeToRemove: r.healthy && r.draining && r.activeJobs === 0 && r.queueDepth === 0,
      };
    }),
  );
}

export type OwnedTask = EngineTask & { engineId: string; engineName: string };

/** Recent tasks of every reachable engine, newest first, each tagged with the engine that holds it. */
export async function allEngineTasks(limit = 40): Promise<{ tasks: OwnedTask[]; unreachable: string[] }> {
  const lists = await Promise.all(engines().map(async (e) => ({ e, tasks: await engineGet<EngineTask[]>(`/tasks?limit=${limit}`, 5000, e) })));
  const tasks = lists
    .flatMap(({ e, tasks }) => (tasks ?? []).map((t) => ({ ...t, engineId: e.id, engineName: e.name })))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);
  return { tasks, unreachable: lists.filter((l) => !l.tasks).map((l) => l.e.name) };
}

/** Pipeline step counts summed over all engines (or one). */
export async function combinedSummary(only?: EngineRef): Promise<Summary | null> {
  const list = only ? [only] : engines();
  const parts = (await Promise.all(list.map((e) => engineGet<Summary>("/pipeline/summary?hours=24", 5000, e)))).filter((s): s is Summary => !!s);
  if (!parts.length) return null;
  const out: Summary = { window_hours: parts[0].window_hours, steps: {}, tasks_in_flight: 0 };
  for (const p of parts) {
    out.tasks_in_flight += p.tasks_in_flight;
    for (const [step, c] of Object.entries(p.steps) as [keyof Summary["steps"], { ok: number; failed: number; running: number; skipped: number }][]) {
      const t = (out.steps[step] ??= { ok: 0, failed: 0, running: 0, skipped: 0 });
      t.ok += c.ok;
      t.failed += c.failed;
      t.running += c.running;
      t.skipped += c.skipped;
    }
  }
  return out;
}
