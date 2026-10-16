import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { episodes, movies, seasons, shows, type CastMember } from "@/db/schema";
import { fail, json, parseBody } from "@/lib/auth/http";
import { env } from "@/lib/env";
import { engineHeaders } from "@/lib/evo/engine";
import { ensureEpisode, ensureMovie } from "@/lib/evo/ensure";
import { allow, viewerId } from "@/lib/evo/guard";
import { promote, promotionFromTask, QUALITIES } from "@/lib/evo/promote";
import { TmdbError } from "@/lib/tmdb";

const body = z
  .object({
    tmdbId: z.number().int().positive(),
    mediaType: z.enum(["movie", "tv"]).default("movie"),
    quality: z.enum(QUALITIES).default("720p"),
    season: z.number().int().min(0).max(10_000).optional(),
    episode: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((b) => b.mediaType === "movie" || (b.season !== undefined && b.episode !== undefined), "season and episode are required for tv");

/** Character names (not actor names) from TMDB's cast, cleaned up: they anchor Sinhala spellings in the translation. */
const characterNames = (cast: CastMember[]) =>
  [...new Set(cast.map((c) => c.character.replace(/\s*\((?:voice|uncredited|archive footage)[^)]*\)/gi, "").trim()).filter(Boolean))].slice(0, 12);

const INGESTS_PER_WINDOW = 12;
const WINDOW_MS = 10 * 60_000;

/** Starts (or joins) an engine task. Signed-in only; the title is checked against TMDB and given a catalog row first. */
export async function POST(req: NextRequest) {
  const userId = await viewerId(req);
  if (!userId) return fail(401, "UNAUTHORIZED", "Not authenticated");
  if (!allow(`ingest:${userId}`, INGESTS_PER_WINDOW, WINDOW_MS)) return fail(429, "RATE_LIMITED", "Too many stream requests, try again in a few minutes");
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { tmdbId, mediaType, quality, season, episode } = parsed.data;

  let runtimeMinutes: number | null = null;
  let synopsis = "";
  let characters: string[] = [];
  try {
    if (mediaType === "movie") {
      const id = await ensureMovie(tmdbId);
      const [m] = await db.select({ r: movies.runtimeMinutes, overview: movies.overview, cast: movies.cast }).from(movies).where(eq(movies.id, id)).limit(1);
      runtimeMinutes = m?.r ?? null;
      synopsis = m?.overview ?? "";
      characters = characterNames(m?.cast ?? []);
    } else {
      const ep = await ensureEpisode(tmdbId, season!, episode!);
      if (!ep) return fail(404, "NOT_FOUND", "Episode not found");
      const [row] = await db
        .select({ r: episodes.runtimeMinutes, epOverview: episodes.overview, showOverview: shows.overview, cast: shows.cast })
        .from(episodes)
        .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
        .innerJoin(shows, eq(shows.id, seasons.showId))
        .where(eq(episodes.id, ep.episodeId))
        .limit(1);
      runtimeMinutes = row?.r ?? null;
      synopsis = [row?.showOverview, row?.epOverview].filter(Boolean).join(" ");
      characters = characterNames(row?.cast ?? []);
    }
  } catch (e) {
    if (e instanceof TmdbError) return fail(404, "NOT_FOUND", "Title not found");
    throw e;
  }

  try {
    const res = await fetch(`${env.EVO_ENGINE_URL}/api/v1/media/ingest`, {
      method: "POST",
      headers: engineHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ tmdb_id: tmdbId, media_type: mediaType, quality, season, episode, runtime_minutes: runtimeMinutes, synopsis: synopsis.slice(0, 1500) || undefined, characters }),
      cache: "no-store",
    });
    if (!res.ok) return json(res.status, { error: `Evo engine returned ${res.status}` });
    const data = (await res.json()) as Record<string, unknown>;
    await reconcile({ ...data, tmdb_id: tmdbId, media_type: mediaType, season: season ?? null, episode: episode ?? null });
    return json(200, data);
  } catch (e) {
    return json(502, { error: e instanceof Error ? e.message : "Failed to connect to the engine" });
  }
}

/** A task the engine already finished may never have reached us (lost webhook): register it now. Idempotent. */
async function reconcile(task: Record<string, unknown>) {
  const input = promotionFromTask(task);
  if (input) await promote(input).catch(() => {});
}
