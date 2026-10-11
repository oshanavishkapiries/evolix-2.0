export const yearOf = (date: string | null | undefined) => (date ? date.slice(0, 4) : "");

export function runtimeText(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/** TMDB rating as "7.4"; empty when unrated. */
export const ratingText = (r: number | null | undefined) => (r && r > 0 ? r.toFixed(1) : "");

export function dateText(date: string | null | undefined) {
  if (!date) return "";
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

export const detailHref = (kind: "movie" | "show", id: string) => (kind === "movie" ? `/movie/${id}` : `/tv/${id}`);

/** "en" -> "English"; falls back to the code. */
export function languageName(code: string | null | undefined) {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** 12345 -> "12.3K votes". */
export const votesText = (n: number | null | undefined) =>
  n && n > 0 ? `${n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : n} votes` : "";
