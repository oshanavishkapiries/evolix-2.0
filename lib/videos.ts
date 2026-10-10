// Isomorphic helpers (client + server) for trailer/video references.
// URLs are only parsed, never fetched.

export const VIDEO_SITES = ["youtube", "vimeo"] as const;
export type VideoSite = (typeof VIDEO_SITES)[number];

export const VIDEO_TYPES = [
  "trailer",
  "teaser",
  "clip",
  "featurette",
  "behind_the_scenes",
  "bloopers",
  "opening_credits",
  "other",
] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];

export const KEY_PATTERNS: Record<VideoSite, RegExp> = {
  youtube: /^[A-Za-z0-9_-]{6,20}$/,
  vimeo: /^\d{5,15}$/,
};

export const isValidKey = (site: VideoSite, key: string) => KEY_PATTERNS[site].test(key);

/** Parses a pasted YouTube/Vimeo URL into {site, key}; null for anything else. */
export function parseVideoUrl(input: string): { site: VideoSite; key: string } | null {
  const raw = input.trim();
  if (!/^https?:\/\//i.test(raw) || !URL.canParse(raw)) return null;
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let site: VideoSite | null = null;
  let key: string | null = null;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    site = "youtube";
    if (parts[0] === "watch") key = url.searchParams.get("v");
    else if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "v") key = parts[1] ?? null;
  } else if (host === "youtu.be") {
    site = "youtube";
    key = parts[0] ?? null;
  } else if (host === "vimeo.com") {
    site = "vimeo";
    key = parts.length === 1 ? parts[0] : null;
  } else if (host === "player.vimeo.com" && parts[0] === "video") {
    site = "vimeo";
    key = parts[1] ?? null;
  }
  return site && key && isValidKey(site, key) ? { site, key } : null;
}

/** Plain external watch URL (opened in a new tab; no embedding). */
export const videoWatchUrl = (site: VideoSite, key: string) =>
  site === "youtube"
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(key)}`
    : `https://vimeo.com/${encodeURIComponent(key)}`;

export const TYPE_LABELS: Record<VideoType, string> = {
  trailer: "Trailer",
  teaser: "Teaser",
  clip: "Clip",
  featurette: "Featurette",
  behind_the_scenes: "Behind the scenes",
  bloopers: "Bloopers",
  opening_credits: "Opening credits",
  other: "Other",
};

/** Video as prefilled from TMDB / sent when saving a new title. */
export type VideoPrefill = {
  site: VideoSite;
  key: string;
  name: string;
  type: VideoType;
  official: boolean;
  language: string | null;
  publishedAt: string | null;
  sortOrder: number;
};

const TYPE_PRIORITY: Record<VideoType, number> = {
  trailer: 0,
  teaser: 1,
  clip: 2,
  featurette: 3,
  behind_the_scenes: 4,
  bloopers: 5,
  opening_credits: 5,
  other: 5,
};

type Rankable = { type: VideoType; official: boolean; language: string | null; publishedAt: string | null };

/** Best first: type priority, official, English, then newest. */
export function compareVideos(a: Rankable, b: Rankable) {
  const time = (x: Rankable) => (x.publishedAt ? Date.parse(x.publishedAt) || 0 : 0);
  return (
    TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type] ||
    Number(b.official) - Number(a.official) ||
    Number(b.language === "en") - Number(a.language === "en") ||
    time(b) - time(a)
  );
}

export const DEFAULT_VIDEO_PICK = 5;
const MAX_SAME_TYPE = 3;

/**
 * Picks the best `limit` videos (ranked order). No more than 3 of one type
 * while other types are available; leftovers fill in when nothing else is left.
 */
export function rankVideos<T extends Rankable>(videos: T[], limit = DEFAULT_VIDEO_PICK): T[] {
  const sorted = [...videos].sort(compareVideos);
  const perType = new Map<VideoType, number>();
  const picked: T[] = [];
  const overflow: T[] = [];
  for (const v of sorted) {
    const n = perType.get(v.type) ?? 0;
    if (picked.length < limit && n < MAX_SAME_TYPE) {
      picked.push(v);
      perType.set(v.type, n + 1);
    } else overflow.push(v);
  }
  return [...picked, ...overflow.slice(0, Math.max(0, limit - picked.length))];
}
