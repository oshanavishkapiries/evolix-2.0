/** Audience for a title that entered the DB through Evo, derived from TMDB genres (Kids section gating). */
export function audienceFromGenres(genres: string[]): "general" | "kids" | "both" {
  const g = new Set(genres.map((x) => x.toLowerCase()));
  if (g.has("kids") || (g.has("family") && g.has("animation"))) return "kids";
  if (g.has("family")) return "both";
  return "general";
}
