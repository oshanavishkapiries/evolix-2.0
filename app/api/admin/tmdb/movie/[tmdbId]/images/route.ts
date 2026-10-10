import { fail, json } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { getTmdbImages } from "@/lib/tmdb";

/** All TMDB images (posters, backdrops, logos) plus the auto-picked selection. */
export const GET = adminRoute<{ tmdbId: string }>(async (_req, { tmdbId }) => {
  const id = Number(tmdbId);
  if (!Number.isInteger(id) || id <= 0) return fail(400, "VALIDATION_ERROR", "Invalid TMDB id");
  const { candidates, selection } = await getTmdbImages("movie", id);
  return json(200, { ...candidates, selection });
});
