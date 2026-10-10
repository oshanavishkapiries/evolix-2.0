import { fail, json } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { getTmdbSeasonImages } from "@/lib/tmdb";

/** Poster candidates for one season. */
export const GET = adminRoute<{ tmdbId: string; seasonNumber: string }>(async (_req, p) => {
  const id = Number(p.tmdbId);
  const season = Number(p.seasonNumber);
  if (!Number.isInteger(id) || id <= 0) return fail(400, "VALIDATION_ERROR", "Invalid TMDB id");
  if (!Number.isInteger(season) || season < 0 || season > 10_000) {
    return fail(400, "VALIDATION_ERROR", "Invalid season number");
  }
  return json(200, { posters: await getTmdbSeasonImages(id, season) });
});
