import { json } from "@/lib/auth/http";
import { subtitleRoute } from "@/lib/subtitles/http";
import { parentQuery, titleTarget } from "@/lib/subtitles/schema";
import { listTracks, publicTrack, resolveParent } from "@/lib/subtitles/store";

export const GET = subtitleRoute(async (req, userId) => {
  const q = req.nextUrl.searchParams;
  const direct = parentQuery.safeParse(Object.fromEntries(q));
  const target = titleTarget.safeParse({ tmdbId: Number(q.get("tmdbId")), mediaType: q.get("mediaType") ?? q.get("type") ?? "movie", season: q.has("season") ? Number(q.get("season")) : undefined, episode: q.has("episode") ? Number(q.get("episode")) : undefined });
  const parent = direct.success ? direct.data as Parameters<typeof listTracks>[0] : target.success ? await resolveParent(target.data) : null;
  if (!parent) return json(400, { message: "Choose a movie or episode" });
  const tracks = await Promise.all((await listTracks(parent, userId)).map((t) => publicTrack(t, userId)));
  const languages: Record<string, typeof tracks> = {};
  for (const t of tracks) (languages[t.language] ??= []).push(t);
  return json(200, { tracks, languages });
}, 120);
