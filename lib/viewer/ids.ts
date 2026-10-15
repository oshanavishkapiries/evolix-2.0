const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: string) => UUID_RE.test(v);

/** Route number segment ("3") to an integer; null for anything else. */
export function parseNumber(v: string | undefined | null, max = 10_000) {
  if (!v || !/^\d{1,5}$/.test(v)) return null;
  const n = Number(v);
  return n <= max ? n : null;
}

export type CardKind = "movie" | "show";

export type MediaId =
  | { kind: "uuid"; id: string }
  | { kind: "tmdb"; tmdbId: number };

export function parseMediaId(v: string | undefined | null): MediaId | null {
  if (!v) return null;
  if (isUuid(v)) return { kind: "uuid", id: v };
  const m = v.match(/^(?:tmdb-)?(\d+)$/);
  if (m) {
    const tmdbId = Number(m[1]);
    if (Number.isInteger(tmdbId) && tmdbId > 0) {
      return { kind: "tmdb", tmdbId };
    }
  }
  return null;
}
