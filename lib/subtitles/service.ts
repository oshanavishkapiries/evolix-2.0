import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { subtitles } from "@/db/schema";
import { engineFetch, type EngineRef } from "@/lib/evo/client";
import { recordSubtitleOwners } from "@/lib/evo/scheduler";
import { pixeldrainId } from "@/lib/viewer/providers";
import { inParent, resolveParent, saveTrack } from "./store";
import type { SubtitleTarget } from "./schema";

const published = z.object({ id: z.string(), url: z.string().refine((u) => pixeldrainId(u) !== null), originRef: z.string(), release: z.string().nullish() });
export class HiddenSubtitleError extends Error {}
/** The provider could not supply a usable subtitle. `message` is engine text for logs, never for viewers. */
class SubtitleDownloadError extends Error {}
export async function downloadTrack(target: SubtitleTarget, engine: EngineRef, ref: string, language: string, label: string, source: "auto" | "opensubtitles") {
  const parent = await resolveParent(target);
  const [blocked] = await db.select({ id: subtitles.id }).from(subtitles).where(and(inParent(parent), eq(subtitles.language, language), eq(subtitles.originRef, ref.split("_").at(-1) ?? ref), eq(subtitles.hidden, true), inArray(subtitles.source, ["auto", "opensubtitles"]))).limit(1);
  if (blocked) throw new HiddenSubtitleError("This subtitle was hidden after problem reports. Choose another release.");
  const res = await engineFetch("/subtitles/select", { method: "POST", body: { ref }, engine, timeoutMs: 180_000 });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new SubtitleDownloadError(typeof data.detail === "string" ? data.detail : "All subtitle candidates failed to download");
  }
  const track = published.parse(await res.json());
  await recordSubtitleOwners(engine, [{ id: track.id }]);
  const existing = await db.select().from(subtitles).where(and(inParent(parent), eq(subtitles.language, language), eq(subtitles.originRef, track.originRef), inArray(subtitles.source, ["auto", "opensubtitles"])));
  if (existing.some((s) => s.hidden)) throw new HiddenSubtitleError("This subtitle was hidden after problem reports. Choose another release.");
  const row = await saveTrack(parent, { language, label: source === "opensubtitles" ? (track.release || label).slice(0, 100) : label, format: "vtt", url: track.url, source: existing[0]?.source ?? source, originRef: track.originRef, engineId: engine.id });
  if (row.hidden) throw new HiddenSubtitleError("This subtitle was hidden after problem reports. Choose another release.");
  return row;
}
export { published };
