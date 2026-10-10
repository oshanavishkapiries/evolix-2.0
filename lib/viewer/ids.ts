const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: string) => UUID_RE.test(v);

/** Route number segment ("3") to an integer; null for anything else. */
export function parseNumber(v: string | undefined | null, max = 10_000) {
  if (!v || !/^\d{1,5}$/.test(v)) return null;
  const n = Number(v);
  return n <= max ? n : null;
}

export type CardKind = "movie" | "show";
