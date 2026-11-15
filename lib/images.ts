// Isomorphic (client + server) TMDB image helpers. No server-only imports.

export const IMAGE_PATH_RE = /^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|svg|webp)$/;
export const GALLERY_MAX = 5;

export const isImagePath = (v: unknown): v is string => typeof v === "string" && IMAGE_PATH_RE.test(v);

/** Full TMDB image URL for a stored path; null when there is no valid path. */
export function imageUrl(path: string | null | undefined, size = "w500") {
  return isImagePath(path) ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

/** Width variants from TMDB /configuration (profile's h632 is height-based, so omitted). */
export const TMDB_IMAGE_WIDTHS = {
  poster: [154, 185, 342, 500],
  backdrop: [300, 780, 1280],
  profile: [45, 185],
  logo: [92, 185, 300, 500],
} as const;
export type ImageKind = keyof typeof TMDB_IMAGE_WIDTHS;

/** Safe to spread onto an img; invalid paths never produce a CDN request. SVGs are not resized. */
export function imageSrcSet(path: string | null | undefined, kind: ImageKind, maxWidth = Infinity) {
  if (!isImagePath(path)) return { src: undefined, srcSet: undefined };
  if (path.endsWith(".svg")) return { src: imageUrl(path, "original")!, srcSet: undefined };
  const widths = TMDB_IMAGE_WIDTHS[kind].filter((width) => width <= maxWidth);
  const fallback = { poster: 342, backdrop: 780, profile: 185, logo: 300 }[kind];
  return {
    src: imageUrl(path, `w${Math.min(fallback, widths.at(-1) ?? fallback)}`)!,
    srcSet: widths.map((width) => `${imageUrl(path, `w${width}`)} ${width}w`).join(", "),
  };
}

// Mirror tokens.css/cards.css. Lazy images use their actual laid-out width (including the
// user's desktop size slider); the remainder supports browsers without sizes=auto.
export const POSTER_ROW_SIZES = "(max-width: 47.99rem) clamp(120px, 30vw, 152px), 216px";
export const LANDSCAPE_ROW_SIZES = "(max-width: 47.99rem) 72vw, 432px";
export const POSTER_GRID_SIZES = "(max-width: 391px) calc((100vw - 44px) / 2), (max-width: 47.99rem) calc((100vw - 56px) / 3), 216px";

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
