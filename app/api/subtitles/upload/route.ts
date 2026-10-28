import { json } from "@/lib/auth/http";
import { engineFetch } from "@/lib/evo/client";
import { titleContext } from "@/lib/evo/context";
import { claimEngine, recordSubtitleOwners } from "@/lib/evo/scheduler";
import { subtitleRoute } from "@/lib/subtitles/http";
import { language, titleTarget } from "@/lib/subtitles/schema";
import { publicTrack, reserveQuota, resolveParent, saveTrack } from "@/lib/subtitles/store";
import { published } from "@/lib/subtitles/service";

export const POST = subtitleRoute(async (req, userId) => {
  const maxBytes = 2 * 1024 * 1024 + 16_384;
  if (Number(req.headers.get("content-length")) > maxBytes) return json(413, { message: "Subtitle must be at most 2 MB" });
  const reader = req.body?.getReader();
  if (!reader) return json(400, { message: "Choose a subtitle file" });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); return json(413, { message: "Subtitle must be at most 2 MB" }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let form: FormData;
  try {
    form = await new Request(req.url, { method: "POST", headers: { "Content-Type": req.headers.get("content-type") ?? "" }, body: bytes }).formData();
  } catch { return json(400, { message: "Upload must be a file form" }); }
  const parsed = titleTarget.safeParse({ tmdbId: Number(form.get("tmdbId")), mediaType: form.get("mediaType") ?? "movie", season: form.has("season") ? Number(form.get("season")) : undefined, episode: form.has("episode") ? Number(form.get("episode")) : undefined });
  const lang = language.safeParse(form.get("language") ?? "en");
  const file = form.get("file");
  if (!parsed.success || !lang.success) return json(400, { message: "Invalid title or language" });
  if (!(file instanceof File) || !/\.(srt|vtt)$/i.test(file.name) || !file.size || file.size > 2 * 1024 * 1024) return json(422, { message: "Choose a non-empty .srt or .vtt file, at most 2 MB" });
  if (!await reserveQuota(userId, "all", "upload", 10)) return json(429, { message: "You can upload 10 subtitles per day" });
  const t = parsed.data;
  const ctx = await titleContext(t.mediaType, t.tmdbId, t.season, t.episode);
  if (!ctx) return json(404, { message: "Title not found" });
  const engine = await claimEngine(`subtitle-upload:${userId}`);
  const res = await engineFetch("/subtitles/upload", { method: "POST", engine, timeoutMs: 180_000, body: { file_name: file.name, content_base64: Buffer.from(await file.arrayBuffer()).toString("base64"), episode: t.mediaType === "tv", runtime_minutes: ctx.runtimeMinutes } });
  if (!res.ok) { const data = await res.json().catch(() => ({})); return json(422, { message: data.detail ?? "Could not validate this subtitle" }); }
  const data = published.parse(await res.json());
  await recordSubtitleOwners(engine, [{ id: data.id }]);
  const track = await saveTrack(await resolveParent(t), { language: lang.data, label: file.name.slice(0, 100), url: data.url, format: "vtt", source: "upload", originRef: `${userId}:${data.id}`, uploadedBy: userId, visibility: "private", engineId: engine.id });
  if (track.hidden) return json(422, { message: "This upload was hidden after problem reports. Choose a corrected file." });
  return json(201, { track: publicTrack(track, userId) });
}, 10);
