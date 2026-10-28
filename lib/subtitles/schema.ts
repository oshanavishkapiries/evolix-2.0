import { z } from "zod";

export const titleTarget = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(["movie", "tv"]).default("movie"),
  season: z.number().int().min(0).max(10_000).optional(),
  episode: z.number().int().min(0).max(100_000).optional(),
}).refine((t) => t.mediaType === "movie" || (t.season !== undefined && t.episode !== undefined), "TV needs a season and episode");
export type SubtitleTarget = z.infer<typeof titleTarget>;
export const language = z.enum(["en", "es", "fr", "de", "pt", "it", "ar", "ru", "si", "hi"]);
export const parentQuery = z.object({ movieId: z.uuid().optional(), episodeId: z.uuid().optional() })
  .refine((p) => Boolean(p.movieId) !== Boolean(p.episodeId), "Choose one title");

export const problem = z.enum(["out_of_sync", "wrong_language", "wrong_movie"]);
export const activityInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), trackId: z.uuid(), playId: z.uuid() }),
  z.object({ action: z.literal("played"), trackId: z.uuid(), playId: z.uuid(), seconds: z.number().min(60).max(86_400) }),
  z.object({ action: z.literal("good"), trackId: z.uuid() }),
  z.object({ action: z.literal("report"), trackId: z.uuid(), reason: problem }),
]);
