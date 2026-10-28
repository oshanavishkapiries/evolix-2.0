import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { json, parseBody } from "@/lib/auth/http";
import { engineFetch } from "@/lib/evo/client";
import { titleContext } from "@/lib/evo/context";
import { claimedEngine, claimEngine, recordTask, sinhalaKey } from "@/lib/evo/scheduler";
import { findSinhala, settleSinhala, type SinhalaTarget } from "@/lib/evo/sinhala";
import { subtitleRoute } from "@/lib/subtitles/http";
import { titleTarget } from "@/lib/subtitles/schema";
import { accessibleTrack, inParent, listTracks, reserveQuota, resolveParent } from "@/lib/subtitles/store";
import { and, eq } from "drizzle-orm";
import { subtitles } from "@/db/schema";
import { pixeldrainId } from "@/lib/viewer/providers";

const target = titleTarget.and(z.object({ sourceTrackId: z.uuid().optional() }));
const keyOf = (t: SinhalaTarget) => sinhalaKey(t.mediaType, t.tmdbId, t.season, t.episode, t.sourceTrackId);
const pathOf = (t: SinhalaTarget) => "/subtitles/si?" + new URLSearchParams({ tmdb_id: String(t.tmdbId), media_type: t.mediaType, ...(t.season !== undefined ? { season: String(t.season) } : {}), ...(t.episode !== undefined ? { episode: String(t.episode) } : {}), ...(t.sourceTrackId ? { source_track_id: t.sourceTrackId } : {}) });

export const POST = subtitleRoute(async (req, userId) => {
  const body = await parseBody(req, target);
  if ("error" in body) return body.error;
  const t = body.data;
  const parent = await resolveParent(t);
  if (!t.sourceTrackId) {
    const existing = await findSinhala(t, userId);
    if (existing) return json(200, { state: "done", subtitle: existing });
    t.sourceTrackId = (await listTracks(parent, userId)).find((s) => s.language === "en")?.id;
  }
  if (!t.sourceTrackId) return json(422, { state: "failed", message: "Find or upload an English subtitle first" });
  const source = await accessibleTrack(t.sourceTrackId, userId);
  if (!source || source.language !== "en" || (parent.movieId ? source.movieId !== parent.movieId : source.episodeId !== parent.episodeId)) return json(404, { message: "English source subtitle not found for this title" });
  const existing = await findSinhala(t, userId);
  if (existing) return json(200, { state: "done", subtitle: existing });
  const engine = await claimEngine(keyOf(t));
  const previousRes = await engineFetch(pathOf(t), { engine });
  const previous = previousRes.ok ? await previousRes.json() as Record<string, unknown> : {};
  if (previous.state === "running" || previous.state === "done") return json(200, await settleSinhala(t, previous, userId, engine.id));
  const ctx = await titleContext(t.mediaType, t.tmdbId, t.season, t.episode);
  if (!ctx) return json(404, { message: "Title not found" });
  const mediaKey = `${t.mediaType}:${t.tmdbId}:${t.season ?? 0}:${t.episode ?? 0}`;
  if (!await reserveQuota(userId, mediaKey, "translation", 3)) return json(429, { message: "You can start 3 new translations per title per day" });
  const releaseReservation = () => db.execute(sql`update subtitle_quota set used = greatest(0, used - 1) where user_id = ${userId}::uuid and media_key = ${mediaKey} and kind = 'translation' and day = current_date`);
  const fileId = pixeldrainId(source.url);
  const res = await engineFetch("/subtitles/si", { method: "POST", engine, body: {
    tmdb_id: t.tmdbId, media_type: t.mediaType, season: t.season, episode: t.episode,
    title: ctx.title || undefined, imdb_id: ctx.imdbId || undefined, synopsis: ctx.synopsis.slice(0, 1500), characters: ctx.characters,
    source_track_id: source.id, source_url: fileId ? `https://pixeldrain.com/api/file/${fileId}` : source.url,
  } });
  if (!res.ok) { await releaseReservation(); return json(502, { message: "The subtitle service could not start this translation" }); }
  const state = await res.json() as Record<string, unknown>;
  // A joined failure is not a new translation and must not consume another reservation.
  if (state.created === false || (state.job_id && state.job_id === previous.job_id)) await releaseReservation();
  if (typeof state.job_id === "string") await recordTask(state.job_id, engine, "sinhala", keyOf(t));
  return json(200, await settleSinhala(t, state, userId, engine.id));
}, 20);

export const GET = subtitleRoute(async (req, userId) => {
  const q = req.nextUrl.searchParams;
  const parsed = target.safeParse({ tmdbId: Number(q.get("tmdbId")), mediaType: q.get("mediaType") ?? "movie", season: q.has("season") ? Number(q.get("season")) : undefined, episode: q.has("episode") ? Number(q.get("episode")) : undefined, sourceTrackId: q.get("sourceTrackId") ?? undefined });
  if (!parsed.success) return json(400, { message: "Invalid title" });
  const t = parsed.data;
  if (t.sourceTrackId) {
    const source = await accessibleTrack(t.sourceTrackId, userId);
    const parent = await resolveParent(t);
    if (!source || !(await db.select({ id: subtitles.id }).from(subtitles).where(and(eq(subtitles.id, source.id), inParent(parent))).limit(1)).length) return json(404, { message: "Source subtitle not found" });
  }
  const existing = await findSinhala(t, userId);
  if (existing) return json(200, { state: "done", subtitle: existing });
  const engine = await claimedEngine(keyOf(t));
  if (!engine) return json(200, { state: "none" });
  const res = await engineFetch(pathOf(t), { engine });
  if (!res.ok) return json(502, { message: "The subtitle service is unavailable" });
  return json(200, await settleSinhala(t, await res.json() as Record<string, unknown>, userId, engine.id));
}, 200);
