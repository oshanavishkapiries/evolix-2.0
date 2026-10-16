/**
 * Which section a title that entered the DB through Evo belongs to, from TMDB genres and the US age rating.
 * Kids = clearly for children; both = family viewing; general = everything else (also when nothing is known).
 */
const KIDS_CERTS = new Set(["G", "TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G"]);
const FAMILY_CERTS = new Set(["PG", "TV-PG"]);

export function audienceFromGenres(genres: string[], certification?: string | null): "general" | "kids" | "both" {
  const g = new Set(genres.map((x) => x.toLowerCase()));
  const childish = g.has("kids") || g.has("family") || g.has("animation");
  if (g.has("kids") || (g.has("family") && g.has("animation"))) return "kids";
  if (certification && KIDS_CERTS.has(certification) && childish) return "kids";
  if (g.has("family") || (certification && FAMILY_CERTS.has(certification) && childish)) return "both";
  return "general";
}
