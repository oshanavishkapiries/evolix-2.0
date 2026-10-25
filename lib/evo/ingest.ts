import { engineFetch, EngineUnavailableError } from "./client";
import { titleContext } from "./context";
import { promote, promotionFromTask } from "./promote";
import { claimEngine, ingestAffinity, ingestKey, markUnhealthy, NoEngineAvailableError, recordSubtitleOwners, recordTask } from "./scheduler";

export type IngestInput = { tmdbId: number; mediaType: "movie" | "tv"; quality: string; season?: number; episode?: number };

export type IngestOutcome =
  | { kind: "started"; data: Record<string, unknown>; engineId: string }
  | { kind: "not_found"; message: string }
  | { kind: "error"; status: number; body: Record<string, unknown> };

/**
 * Starts (or joins) the job for one title and quality on the engine that owns it, claiming an engine first.
 * With `avoidEngine` the job is moved off that engine: a controlled retry that creates a new task elsewhere
 * (the old task keeps its owner). Throws TmdbError when TMDB cannot find the title.
 */
export async function startIngest(input: IngestInput, opts: { avoidEngine?: string } = {}): Promise<IngestOutcome> {
  const { tmdbId, mediaType, quality, season, episode } = input;
  // Canonical name and IMDb id come from us, not from whichever provider the engine extracts from: providers name
  // titles after their own site, and without an IMDb id there are no subtitles (and nothing to translate).
  const ctx = await titleContext(mediaType, tmdbId, season, episode);
  if (!ctx) return { kind: "not_found", message: "Episode not found" };

  const key = ingestKey(mediaType, tmdbId, season, episode, quality);
  const payload = { tmdb_id: tmdbId, media_type: mediaType, quality, season, episode, runtime_minutes: ctx.runtimeMinutes, synopsis: ctx.synopsis.slice(0, 1500) || undefined, characters: ctx.characters, title: ctx.title || undefined, imdb_id: ctx.imdbId ?? undefined };

  // Two tries: if the claimed engine turns out to be down, the second claim moves this job to a healthy one.
  let avoid = opts.avoidEngine;
  for (let attempt = 0; attempt < 2; attempt++) {
    let engine;
    try {
      engine = await claimEngine(key, { affinityPrefix: ingestAffinity(mediaType, tmdbId, season, episode), avoid });
    } catch (e) {
      if (e instanceof NoEngineAvailableError) return { kind: "error", status: 503, body: { error: e.message, code: "NO_ENGINE" } };
      throw e;
    }
    try {
      const res = await engineFetch("/ingest", { method: "POST", timeoutMs: 30_000, body: payload, engine });
      if (!res.ok) return { kind: "error", status: res.status, body: { error: `Evo engine returned ${res.status}` } };
      const data = (await res.json()) as Record<string, unknown>;
      if (typeof data.task_id === "string") await recordTask(data.task_id, engine, "ingest", key);
      await recordSubtitleOwners(engine, data.subtitles);
      // A task the engine already finished may never have reached us (lost webhook): register it now. Idempotent.
      const promotion = promotionFromTask({ ...data, tmdb_id: tmdbId, media_type: mediaType, season: season ?? null, episode: episode ?? null });
      if (promotion) await promote(promotion, engine.id).catch(() => {});
      return { kind: "started", data, engineId: engine.id };
    } catch (e) {
      if (!(e instanceof EngineUnavailableError)) return { kind: "error", status: 502, body: { error: e instanceof Error ? e.message : "Failed to connect to the engine" } };
      await markUnhealthy(engine, e.message);
      avoid = undefined; // the claim moves because the engine is down, not because an admin asked
      if (attempt === 1) return { kind: "error", status: 502, body: { error: e.message, code: "ENGINE_UNAVAILABLE" } };
    }
  }
  return { kind: "error", status: 502, body: { error: "Failed to reach an engine" } };
}

/** Reads a claim key made by `ingestKey` back into its parts (null for any other kind of key). */
export function parseIngestKey(key: string | null | undefined): IngestInput | null {
  const m = /^ingest:(movie|tv):(\d+):(\d+):(\d+):(\d{3,4}p)$/.exec(key ?? "");
  if (!m) return null;
  const tv = m[1] === "tv";
  return { mediaType: m[1] as "movie" | "tv", tmdbId: Number(m[2]), season: tv ? Number(m[3]) : undefined, episode: tv ? Number(m[4]) : undefined, quality: m[5] };
}
