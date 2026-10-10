import { fail, json } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { getShowDetails } from "@/lib/tmdb";

export const GET = adminRoute<{ tmdbId: string }>(async (_req, { tmdbId }) => {
  const id = Number(tmdbId);
  if (!Number.isInteger(id) || id <= 0) return fail(400, "VALIDATION_ERROR", "Invalid TMDB id");
  return json(200, { show: await getShowDetails(id) });
});
