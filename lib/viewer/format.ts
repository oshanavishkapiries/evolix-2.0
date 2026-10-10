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
