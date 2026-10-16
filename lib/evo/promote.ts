import { revalidateTag } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { sources, subtitles } from "@/db/schema";
import { pixeldrainId } from "@/lib/viewer/providers";
import { CATALOG_TAG } from "@/lib/viewer/cache";
import { ensureEpisode, ensureMovie } from "./ensure";

export const QUALITIES = ["1080p", "720p", "480p", "360p"] as const;
/** Lower plays first: 720p is the default pick, then the others by descending quality. */
const RANK: Record<string, number> = { "720p": 0, "1080p": 1, "480p": 2, "360p": 3 };

const pixeldrainUrl = z.string().max(2048).refine((u) => pixeldrainId(u) !== null, "Must be a Pixeldrain file URL");

/** What the engine knows once a quality has been cached to the CDN (webhook body and status reconcile). */
export const promotionInput = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(["movie", "tv"]),
  season: z.number().int().min(0).max(10_000).nullish(),
  episode: z.number().int().min(0).max(100_000).nullish(),
  // Both absent for a subtitles-only completion (on-demand Sinhala translation: no video was cached).
  quality: z.string().regex(/^\d{3,4}p$/).optional(),
  resultUrl: pixeldrainUrl.optional(),
  subtitles: z
    .array(z.object({ language: z.string().min(2).max(10), label: z.string().min(1).max(100), url: pixeldrainUrl }))
    .max(30)
    .default([]),
})
  .refine((b) => (b.quality === undefined) === (b.resultUrl === undefined), "quality and resultUrl go together")
  .refine((b) => b.resultUrl !== undefined || b.subtitles.length > 0, "Nothing to register");
export type PromotionInput = z.infer<typeof promotionInput>;

/**
 * Registers a cached file as a playable source (one per quality) plus its subtitle tracks, creating the
 * catalog rows if needed. Idempotent: re-sending the same completion just refreshes the URLs.
 */
export async function promote(input: PromotionInput) {
  const isMovie = input.mediaType === "movie";
  let parent: { movieId: string } | { episodeId: string };
  if (isMovie) {
    parent = { movieId: await ensureMovie(input.tmdbId) };
  } else {
    if (input.season == null || input.episode == null) throw new Error("season and episode are required for tv");
    const ep = await ensureEpisode(input.tmdbId, input.season, input.episode);
    if (!ep) throw new Error("Episode does not exist on TMDB");
    parent = { episodeId: ep.episodeId };
  }

  if (input.quality && input.resultUrl) {
    await db
      .insert(sources)
      .values({
        ...parent,
        label: input.quality,
        kind: "direct",
        url: input.resultUrl,
        quality: input.quality,
        audioLanguage: "en",
        sortOrder: RANK[input.quality] ?? 9,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: "movieId" in parent ? [sources.movieId, sources.quality] : [sources.episodeId, sources.quality],
        set: { url: input.resultUrl, kind: "direct", isActive: true },
      });
  }

  for (const [i, sub] of input.subtitles.entries()) {
    await db
      .insert(subtitles)
      .values({ ...parent, label: sub.label, language: sub.language, url: sub.url, format: "vtt", sortOrder: i })
      .onConflictDoUpdate({
        target: "movieId" in parent ? [subtitles.movieId, subtitles.language] : [subtitles.episodeId, subtitles.language],
        set: { url: sub.url, label: sub.label, format: "vtt" },
      });
  }

  // Watch pages are cached; expire them so the new source shows up immediately.
  revalidateTag(CATALOG_TAG, { expire: 0 });
  return parent;
}

/** Engine task status payload (snake_case) -> promotion input, or null when it is not a finished cache job. */
export function promotionFromTask(task: Record<string, unknown>): PromotionInput | null {
  if (task.status !== "COMPLETED" || !task.result_url) return null;
  const parsed = promotionInput.safeParse({
    tmdbId: task.tmdb_id,
    mediaType: task.media_type,
    season: task.season ?? null,
    episode: task.episode ?? null,
    quality: task.resolved_quality ?? task.requested_quality,
    resultUrl: task.result_url,
    subtitles: Array.isArray(task.cdn_subtitles) ? task.cdn_subtitles : [],
  });
  return parsed.success ? parsed.data : null;
}
