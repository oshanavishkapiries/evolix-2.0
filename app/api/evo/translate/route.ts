import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, json, parseBody } from "@/lib/auth/http";
import { engineFetch, EngineUnavailableError } from "@/lib/evo/client";
import { titleContext } from "@/lib/evo/context";
import { allow, viewerId } from "@/lib/evo/guard";
import { claimedEngine, claimEngine, markUnhealthy, NoEngineAvailableError, recordTask, sinhalaKey } from "@/lib/evo/scheduler";
import { findSinhala, settleSinhala, type SinhalaTarget } from "@/lib/evo/sinhala";
import { TmdbError } from "@/lib/tmdb";

const target = z
  .object({
    tmdbId: z.number().int().positive(),
    mediaType: z.enum(["movie", "tv"]).default("movie"),
    season: z.number().int().min(0).max(10_000).optional(),
    episode: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((b) => b.mediaType === "movie" || (b.season !== undefined && b.episode !== undefined), "season and episode are required for tv");

// Starting a translation is not rate limited for now (no spend cap either); only progress polling is.
const POLL_PER_WINDOW = 200;
const WINDOW_MS = 10 * 60_000;

const enginePath = (t: SinhalaTarget) =>
  "/subtitles/si?" +
  new URLSearchParams({ tmdb_id: String(t.tmdbId), media_type: t.mediaType, ...(t.season !== undefined ? { season: String(t.season) } : {}), ...(t.episode !== undefined ? { episode: String(t.episode) } : {}) });

/**
 * Starts (or joins) the Sinhala translation of a title's English subtitle, the first time a viewer picks it.
 * Identified by TMDB id alone: no engine task has to exist. One job per title, whoever asks.
 */
export async function POST(req: NextRequest) {
  const userId = await viewerId(req);
  if (!userId) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const parsed = await parseBody(req, target);
  if ("error" in parsed) return parsed.error;
  const t: SinhalaTarget = parsed.data;

  try {
    // Already registered (this or an earlier run): no engine call, no cost.
    const existing = await findSinhala(t);
    if (existing) return json(200, { state: "done", subtitle: existing });

    const ctx = await titleContext(t.mediaType, t.tmdbId, t.season, t.episode);
    if (!ctx) return fail(404, "NOT_FOUND", "Episode not found");
    if (!ctx.imdbId) return json(200, { state: "failed", message: "This title has no English subtitle to translate from" });

    // One job per title across all engines: the claim decides which engine runs it (and the engine joins duplicates).
    const key = sinhalaKey(t.mediaType, t.tmdbId, t.season, t.episode);
    const body = {
      tmdb_id: t.tmdbId,
      media_type: t.mediaType,
      season: t.season,
      episode: t.episode,
      title: ctx.title || undefined,
      imdb_id: ctx.imdbId,
      synopsis: ctx.synopsis.slice(0, 1500) || undefined,
      characters: ctx.characters,
    };
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      const engine = await claimEngine(key);
      try {
        res = await engineFetch("/subtitles/si", { method: "POST", body, engine });
        if (res.ok) {
          const data = (await res.clone().json().catch(() => ({}))) as { job_id?: unknown };
          if (typeof data.job_id === "string") await recordTask(data.job_id, engine, "sinhala", key);
        }
      } catch (e) {
        if (!(e instanceof EngineUnavailableError) || attempt === 1) throw e;
        await markUnhealthy(engine, e.message);
      }
    }
    if (!res || !res.ok) return json(502, { error: `Evo engine returned ${res?.status ?? "no answer"}` });
    return json(200, await settleSinhala(t, (await res.json()) as Record<string, unknown>));
  } catch (e) {
    if (e instanceof TmdbError) return fail(404, "NOT_FOUND", "Title not found");
    if (e instanceof NoEngineAvailableError) return json(503, { error: e.message, code: "NO_ENGINE" });
    return json(502, { error: e instanceof Error ? e.message : "Failed to connect to the engine" });
  }
}

/** Progress of a translation (query: tmdbId, mediaType, season, episode). Never starts one. */
export async function GET(req: NextRequest) {
  const userId = await viewerId(req);
  if (!userId) return fail(401, "UNAUTHORIZED", "Not authenticated");
  if (!allow(`translate-poll:${userId}`, POLL_PER_WINDOW, WINDOW_MS)) return fail(429, "RATE_LIMITED", "Too many requests, slow down");
  const q = req.nextUrl.searchParams;
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const parsed = target.safeParse({ tmdbId: num("tmdbId"), mediaType: q.get("mediaType") ?? undefined, season: num("season"), episode: num("episode") });
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid title");
  const t: SinhalaTarget = parsed.data;

  try {
    const existing = await findSinhala(t);
    if (existing) return json(200, { state: "done", subtitle: existing });
    // Poll the engine that owns this title's job; with no job claimed there is nothing to ask.
    const engine = await claimedEngine(sinhalaKey(t.mediaType, t.tmdbId, t.season, t.episode));
    if (!engine) return json(200, await settleSinhala(t, { state: "none" }));
    const res = await engineFetch(enginePath(t), { engine });
    if (!res.ok) return json(502, { error: `Evo engine returned ${res.status}` });
    return json(200, await settleSinhala(t, (await res.json()) as Record<string, unknown>));
  } catch (e) {
    if (e instanceof TmdbError) return fail(404, "NOT_FOUND", "Title not found");
    if (e instanceof NoEngineAvailableError) return json(503, { error: e.message, code: "NO_ENGINE" });
    return json(502, { error: e instanceof Error ? e.message : "Failed to connect to the engine" });
  }
}
