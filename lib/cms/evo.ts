import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, movies, seasons, shows, sources } from "@/db/schema";
import { engineFetch, engineGet, type EngineRef } from "@/lib/evo/client";
import { engineForTask } from "@/lib/evo/scheduler";
import type { FlowEvent, Summary } from "@/lib/evo/flow";

export type EngineTask = {
  task_id: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  season: number | null;
  episode: number | null;
  title: string | null;
  requested_quality: string;
  resolved_quality: string | null;
  status: string;
  message: string;
  result_url: string | null;
  cache_failed: boolean;
  updated_at: string;
};

/** Recent engine tasks plus reachability; never throws (the page must render when the engine is down). */
export async function engineOverview(limit = 40, engine?: EngineRef): Promise<{ online: boolean; health: Record<string, unknown> | null; tasks: EngineTask[]; error?: string }> {
  try {
    const [h, t] = await Promise.all([
      engineFetch("/health", { timeoutMs: 5000, engine }),
      engineFetch(`/tasks?limit=${limit}`, { timeoutMs: 5000, engine }),
    ]);
    if (!t.ok) return { online: h.ok, health: h.ok ? await h.json() : null, tasks: [], error: `Engine returned ${t.status} for the task list` };
    return { online: true, health: await h.json(), tasks: await t.json() };
  } catch (e) {
    return { online: false, health: null, tasks: [], error: e instanceof Error ? e.message : "Engine unreachable" };
  }
}

/** Cached CDN sources, newest first, with the title they belong to. */
export async function recentCachedSources(limit = 40) {
  const [movieRows, episodeRows] = await Promise.all([
    db
      .select({ id: sources.id, quality: sources.quality, url: sources.url, isActive: sources.isActive, createdAt: sources.createdAt, engineId: sources.engineId, title: movies.title, titleId: movies.id })
      .from(sources)
      .innerJoin(movies, eq(movies.id, sources.movieId))
      .orderBy(desc(sources.createdAt))
      .limit(limit),
    db
      .select({
        id: sources.id,
        quality: sources.quality,
        url: sources.url,
        isActive: sources.isActive,
        createdAt: sources.createdAt,
        engineId: sources.engineId,
        title: shows.name,
        titleId: shows.id,
        season: seasons.seasonNumber,
        episode: episodes.episodeNumber,
      })
      .from(sources)
      .innerJoin(episodes, eq(episodes.id, sources.episodeId))
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .innerJoin(shows, eq(shows.id, seasons.showId))
      .orderBy(desc(sources.createdAt))
      .limit(limit),
  ]);
  return [
    ...movieRows.map((r) => ({ ...r, kind: "movie" as const, context: "Movie" })),
    ...episodeRows.map((r) => ({ ...r, kind: "show" as const, context: `S${r.season}E${r.episode}` })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

export type TaskDetail = EngineTask & { progress_pct: number; imdb_id?: string | null; subtitles?: unknown[] | null; cdn_subtitles?: unknown[] | null };

/** One engine task with its step events; null when the engine is down or the task is unknown. */
export async function engineTaskDetail(taskId: string): Promise<{ task: TaskDetail; events: FlowEvent[] } | null> {
  const engine = await engineForTask(taskId).catch(() => null);
  if (!engine) return null;
  const [task, events] = await Promise.all([
    engineGet<TaskDetail>(`/status/${taskId}`, 5000, engine),
    engineGet<FlowEvent[]>(`/tasks/${taskId}/events`, 5000, engine),
  ]);
  return task ? { task, events: events ?? [] } : null;
}

export const engineSummary = (engine?: EngineRef) => engineGet<Summary>("/pipeline/summary?hours=24", 5000, engine);
