import { json } from "@/lib/auth/http";
import { engineFetch } from "@/lib/evo/client";
import { titleContext } from "@/lib/evo/context";
import { claimEngine, recordSubtitleOwners } from "@/lib/evo/scheduler";
import { subtitleRoute } from "@/lib/subtitles/http";
import { language, titleTarget } from "@/lib/subtitles/schema";
import { signCandidate } from "@/lib/subtitles/candidates";

export const GET = subtitleRoute(async (req, userId) => {
  const q = req.nextUrl.searchParams;
  const parsed = titleTarget.safeParse({ tmdbId: Number(q.get("tmdbId")), mediaType: q.get("type") ?? q.get("mediaType") ?? "movie", season: q.has("season") ? Number(q.get("season")) : undefined, episode: q.has("episode") ? Number(q.get("episode")) : undefined });
  const lang = language.safeParse(q.get("lang") ?? "en");
  if (!parsed.success || !lang.success) return json(400, { message: "Invalid title or language" });
  const target = parsed.data;
  const ctx = await titleContext(target.mediaType, target.tmdbId, target.season, target.episode);
  if (!ctx?.imdbId) return json(200, { candidates: [] });
  const engine = await claimEngine(`subtitles:${target.mediaType}:${target.tmdbId}:${target.season ?? 0}:${target.episode ?? 0}`);
  const query = new URLSearchParams({ imdb_id: ctx.imdbId, lang: lang.data, ...(target.season !== undefined ? { season: String(target.season) } : {}), ...(target.episode !== undefined ? { episode: String(target.episode) } : {}) });
  const res = await engineFetch(`/subtitles/search?${query}`, { engine, timeoutMs: 20_000 });
  if (!res.ok) return json(502, { message: "Subtitle search is unavailable. Try again." });
  const rows = await res.json() as { ref: string; release: string; downloads: number; rating: number | null; fileName: string }[];
  await recordSubtitleOwners(engine, rows.map((r) => ({ id: r.ref })));
  const candidates = await Promise.all(rows.map(async (row) => ({ ...row, lang: lang.data, ref: await signCandidate({ target, engineId: engine.id, providerRef: row.ref, lang: lang.data, label: (row.release || "OpenSubtitles").slice(0, 100) }, userId) })));
  return json(200, { candidates });
}, 10);
