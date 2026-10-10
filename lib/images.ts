// Isomorphic (client + server) TMDB image helpers. No server-only imports.

export const IMAGE_PATH_RE = /^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|svg|webp)$/;
export const GALLERY_MAX = 5;

export const isImagePath = (v: unknown): v is string => typeof v === "string" && IMAGE_PATH_RE.test(v);

/** Full TMDB image URL for a stored path; null when there is no valid path. */
export function imageUrl(path: string | null | undefined, size = "w500") {
  return isImagePath(path) ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

export type ImageCandidate = {
  filePath: string;
  width: number;
  height: number;
  /** ISO 639-1 code, or null for language-neutral (no text) images. */
  language: string | null;
  voteAverage: number;
};

export type ImageCandidates = {
  posters: ImageCandidate[];
  backdrops: ImageCandidate[];
  logos: ImageCandidate[];
};

export type ImageSelection = {
  posterPath: string | null;
  backdropPath: string | null;
  logoPath: string | null;
  galleryBackdrops: string[];
};

export const EMPTY_CANDIDATES: ImageCandidates = { posters: [], backdrops: [], logos: [] };
