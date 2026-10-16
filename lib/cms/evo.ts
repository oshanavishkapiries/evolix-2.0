import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, movies, seasons, shows, sources } from "@/db/schema";
import { env } from "@/lib/env";
import { engineHeaders } from "@/lib/evo/engine";

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
export async function engineOverview(limit = 40): Promise<{ online: boolean; health: Record<string, unknown> | null; tasks: EngineTask[]; error?: string }> {
  try {
    const [h, t] = await Promise.all([
      fetch(`${env.EVO_ENGINE_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(5000) }),
      fetch(`${env.EVO_ENGINE_URL}/api/v1/media/tasks?limit=${limit}`, { headers: engineHeaders(), cache: "no-store", signal: AbortSignal.timeout(5000) }),
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
      .select({ id: sources.id, quality: sources.quality, url: sources.url, isActive: sources.isActive, createdAt: sources.createdAt, title: movies.title, titleId: movies.id })
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
