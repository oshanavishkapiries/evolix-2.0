// Pure auto-pick helpers for TMDB images (no I/O, unit-testable).
import {
  GALLERY_MAX,
  type ImageCandidate,
  type ImageCandidates,
  type ImageSelection,
} from "@/lib/images";

const POSTER_MIN_WIDTH = 1000;
const BACKDROP_MIN_WIDTH = 1920;

/** Higher vote average first, then wider, then path for a stable order. */
export const byScore = (a: ImageCandidate, b: ImageCandidate) =>
  b.voteAverage - a.voteAverage || b.width - a.width || a.filePath.localeCompare(b.filePath);

const best = (list: ImageCandidate[]) => [...list].sort(byScore)[0] ?? null;
const isEnOrNull = (c: ImageCandidate) => c.language === null || c.language === "en";

/** Returns the first non-empty tier's best candidate. */
function firstTier(tiers: ImageCandidate[][]): ImageCandidate | null {
  for (const t of tiers) if (t.length) return best(t);
  return null;
}

export function pickPoster(posters: ImageCandidate[]): ImageCandidate | null {
  const pool = posters.filter(isEnOrNull);
  return firstTier([
    pool.filter((c) => c.width >= POSTER_MIN_WIDTH),
    pool,
    posters,
  ]);
}

export function pickBackdrop(backdrops: ImageCandidate[]): ImageCandidate | null {
  const clean = backdrops.filter((c) => c.language === null);
  const en = backdrops.filter((c) => c.language === "en");
  const big = (l: ImageCandidate[]) => l.filter((c) => c.width >= BACKDROP_MIN_WIDTH);
  return firstTier([big(clean), big(en), clean, en, backdrops]);
}

export function pickLogo(logos: ImageCandidate[]): ImageCandidate | null {
  return firstTier([
    logos.filter((c) => c.language === "en"),
    logos.filter((c) => c.language === null),
    logos,
  ]);
}

export function pickGallery(
  backdrops: ImageCandidate[],
  mainPath: string | null,
  count = GALLERY_MAX,
): string[] {
  const rest = backdrops.filter((c) => c.filePath !== mainPath);
  const preferred = rest.filter(isEnOrNull).sort(byScore);
  const others = rest.filter((c) => !isEnOrNull(c)).sort(byScore);
  return [...preferred, ...others].slice(0, count).map((c) => c.filePath);
}

export function pickImages(c: ImageCandidates): ImageSelection {
  const backdrop = pickBackdrop(c.backdrops);
  return {
    posterPath: pickPoster(c.posters)?.filePath ?? null,
    backdropPath: backdrop?.filePath ?? null,
    logoPath: pickLogo(c.logos)?.filePath ?? null,
    galleryBackdrops: pickGallery(c.backdrops, backdrop?.filePath ?? null),
  };
}
