import { json, parseBody } from "@/lib/auth/http";
import { engineFetch } from "@/lib/evo/client";
import { titleContext } from "@/lib/evo/context";
import { claimEngine } from "@/lib/evo/scheduler";
import { subtitleRoute } from "@/lib/subtitles/http";
import { titleTarget } from "@/lib/subtitles/schema";
import { listTracks, publicTrack, resolveParent } from "@/lib/subtitles/store";
import { downloadTrack, HiddenSubtitleError } from "@/lib/subtitles/service";

/** Titles with no usable automatic subtitle are not searched again for a while; the picker still searches on demand. */
const NO_AUTO_MS = 10 * 60_000;
const noAuto = new Map<string, { until: number; message: string }>();
const remember = (key: string, message: string) => {
  if (noAuto.size > 500) noAuto.delete(noAuto.keys().next().value!);
  noAuto.set(key, { until: Date.now() + NO_AUTO_MS, message });
};

export const POST = subtitleRoute(async (req, userId) => {
  const parsed = await parseBody(req, titleTarget);
  if ("error" in parsed) return parsed.error;
  const t = parsed.data;
  const existing = (await listTracks(await resolveParent(t), userId)).find((s) => s.language === "en");
  if (existing) return json(200, { track: publicTrack(existing, userId) });
  const titleKey = `${t.mediaType}:${t.tmdbId}:${t.season ?? 0}:${t.episode ?? 0}`;
  const recent = noAuto.get(titleKey);
  if (recent && recent.until > Date.now()) return json(200, { track: null, needsChoice: true, message: recent.message });
  const ctx = await titleContext(t.mediaType, t.tmdbId, t.season, t.episode);
  if (!ctx?.imdbId) return json(200, { track: null, needsChoice: true, message: "No automatic English subtitles were found" });
  const engine = await claimEngine(`subtitles:${t.mediaType}:${t.tmdbId}:${t.season ?? 0}:${t.episode ?? 0}`);
  const q = new URLSearchParams({ imdb_id: ctx.imdbId, lang: "en", ...(t.season !== undefined ? { season: String(t.season) } : {}), ...(t.episode !== undefined ? { episode: String(t.episode) } : {}) });
  const res = await engineFetch(`/subtitles/search?${q}`, { engine, timeoutMs: 20_000 });
  const choices = res.ok ? await res.json() as { ref: string }[] : [];
  if (!choices.length) {
    remember(titleKey, "No automatic English subtitles were found");
    return json(200, { track: null, needsChoice: true, message: "No automatic English subtitles were found" });
  }
  let message = "All automatic subtitle downloads failed";
  for (const choice of choices.slice(0, 5)) {
    try {
      const track = await downloadTrack(t, engine, choice.ref, "en", "English", "auto");
      return json(200, { track: publicTrack(track, userId) });
    } catch (e) {
      message = e instanceof Error ? e.message : message;
      // A rejected library origin may have downloaded correctly; continue to the next release.
      if (!(e instanceof HiddenSubtitleError)) break;
    }
  }
  remember(titleKey, message);
  return json(200, { track: null, needsChoice: true, message });
}, 6);
