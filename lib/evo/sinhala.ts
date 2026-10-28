import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { subtitles } from "@/db/schema";
import type { WatchSubtitle } from "@/lib/viewer/watch";
import { ensureEpisode, ensureMovie } from "./ensure";
import { promote } from "./promote";
import { visibleTo } from "@/lib/subtitles/store";

export type SinhalaTarget = { tmdbId: number; mediaType: "movie" | "tv"; season?: number; episode?: number; sourceTrackId?: string };

/** What the player needs to show the on-demand Sinhala subtitles (engine state, plus the track once it exists). */
export type SinhalaState = {
  state: "none" | "running" | "done" | "failed" | "unavailable";
  message?: string;
  progress?: { done: number; total: number } | null;
  subtitle?: WatchSubtitle;
};

/** The registered Sinhala track of a title/episode, or null. Creates the catalog row like the other Evo routes. */
export async function findSinhala(t: SinhalaTarget, userId?: string): Promise<WatchSubtitle | null> {
  let parent;
  if (t.mediaType === "movie") parent = eq(subtitles.movieId, await ensureMovie(t.tmdbId));
  else {
    const ep = await ensureEpisode(t.tmdbId, t.season!, t.episode!);
    if (!ep) return null;
    parent = eq(subtitles.episodeId, ep.episodeId);
  }
  const [row] = await db
    .select({ id: subtitles.id, label: subtitles.label, language: subtitles.language, format: subtitles.format, url: subtitles.url,
      source: subtitles.source, originTrackId: subtitles.originTrackId, visibility: subtitles.visibility, score: subtitles.score, lastUsedAt: subtitles.lastUsedAt })
    .from(subtitles)
    .where(and(parent, eq(subtitles.language, "si"), t.sourceTrackId ? or(eq(subtitles.originTrackId, t.sourceTrackId),
        // Sinhala made before the library has no origin: it was translated from the automatic English, so it fits that source.
        and(isNull(subtitles.originTrackId), sql`exists (select 1 from subtitles src where src.id = ${t.sourceTrackId}::uuid and src.source = 'auto')`)) : undefined,
      userId ? visibleTo(userId) : and(eq(subtitles.visibility, "shared"), eq(subtitles.hidden, false))))
    .orderBy(sql`${subtitles.originTrackId} is null`, desc(subtitles.score), sql`${subtitles.lastUsedAt} desc nulls last`, subtitles.id)
    .limit(1);
  return row ?? null;
}

/**
 * Engine job state -> app state. A finished job is registered here too (idempotent), so a lost completion
 * webhook cannot leave the viewer without the track the engine already has.
 */
export async function settleSinhala(t: SinhalaTarget, engine: Record<string, unknown>, userId?: string, engineId?: string): Promise<SinhalaState> {
  const state = engine.state;
  if (state === "done") {
    const sub = engine.subtitle as { label?: string; url?: string } | undefined;
    if (sub?.url) {
      await promote({ tmdbId: t.tmdbId, mediaType: t.mediaType, season: t.season ?? null, episode: t.episode ?? null, subtitles: [{ language: "si", label: sub.label ?? "Sinhala (AI)", url: sub.url,
        source: t.sourceTrackId ? "translation" : "auto", originTrackId: t.sourceTrackId ?? null,
      }] }, engineId);
      const track = await findSinhala(t, userId);
      if (track) return { state: "done", subtitle: track };
    }
    return { state: "failed", message: "The subtitles could not be registered" };
  }
  if (state === "running" || state === "failed" || state === "unavailable" || state === "none") {
    return { state, message: typeof engine.message === "string" ? engine.message : undefined, progress: (engine.progress as SinhalaState["progress"]) ?? null };
  }
  return { state: "failed", message: "Unexpected answer from the subtitle service" };
}
