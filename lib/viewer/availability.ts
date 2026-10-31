import { tzDay } from "@/lib/tz";

/** TMDB supplies calendar dates, not release times. Unknown dates do not block older catalog entries. */
export function isUpcoming(airDate: string | null | undefined, today = tzDay(new Date())): boolean {
  return Boolean(airDate && airDate > today);
}

/** Keep the full episode list for display, but navigate only through episodes that have aired. */
export function episodeNeighbors<T extends { airDate: string | null; seasonNumber: number; episodeNumber: number }>(
  episodes: T[], current: T, today = tzDay(new Date()),
): { prev: T | null; next: T | null } {
  const available = episodes.filter((e) => !isUpcoming(e.airDate, today));
  const i = available.findIndex((e) => e.seasonNumber === current.seasonNumber && e.episodeNumber === current.episodeNumber);
  return i < 0 ? { prev: null, next: null } : { prev: available[i - 1] ?? null, next: available[i + 1] ?? null };
}
