import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, movies, seasons, shows } from "@/db/schema";
import { parseMediaId, parseNumber } from "./ids";

const VISIBILITY_TTL_MS = 30_000;
const VISIBILITY_LIMIT = 1000;
// Proxy and route handlers are separate bundles in one Node process; sharing the Map through
// globalThis lets an admin route's invalidation reach the proxy's copy on the same instance.
const VISIBILITY_KEY = Symbol.for("evolix.titleVisibility");
const globals = globalThis as { [VISIBILITY_KEY]?: Map<string, { until: number; result: Promise<boolean | null> }> };
const visibility = (globals[VISIBILITY_KEY] ??= new Map());

/**
 * Proxy cannot use Next cache APIs. This bounded cache is per process: another instance
 * (or a separate Proxy runtime) can retain a positive decision for at most 30 seconds.
 */
export function invalidateTitleVisibility(kind: "movie" | "show", id: string) {
  const base = `/${kind === "movie" ? "movie" : "tv"}/${id}`;
  for (const key of visibility.keys()) {
    if (key === base || key.startsWith(`${base}/`) || key.startsWith(`/watch${base}/`)) visibility.delete(key);
  }
}

export async function titleRouteVisible(pathname: string): Promise<boolean | null> {
  // Movie detail/watch share a check; episode decisions remain separate from show visibility.
  const path = pathname.replace(/\/+$/, "");
  const key = /^\/watch\/movie\/[^/]+$/.test(path) ? path.slice("/watch".length) : path;
  const hit = visibility.get(key);
  if (hit && hit.until > Date.now()) return hit.result;
  visibility.delete(key);
  if (visibility.size >= VISIBILITY_LIMIT) visibility.delete(visibility.keys().next().value!);
  const entry = { until: Date.now() + VISIBILITY_TTL_MS, result: lookupTitleRouteVisible(pathname) };
  visibility.set(key, entry);
  try {
    const result = await entry.result;
    // Only "visible" is reused: a stale positive is caught by the blocking page's notFound(),
    // but a stale negative would 404 a just-republished title for the whole TTL.
    if (result === false && visibility.get(key) === entry) visibility.delete(key);
    return result;
  } catch (error) {
    if (visibility.get(key) === entry) visibility.delete(key);
    throw error;
  }
}

/**
 * Cheap visibility check used by the proxy so missing/unpublished/hidden titles get a real
 * HTTP 404 (pages stream under Cache Components, which fixes the status at 200).
 * Returns null for paths that are not a title route.
 */
async function lookupTitleRouteVisible(pathname: string): Promise<boolean | null> {
  const path = pathname.replace(/\/+$/, "");
  let m = /^(?:\/watch)?\/movie\/([^/]+)$/.exec(path);
  if (m) {
    const media = parseMediaId(m[1]);
    if (!media) return false;
    if (media.kind === "tmdb") return true;
    const [row] = await db
      .select({ id: movies.id })
      .from(movies)
      .where(and(eq(movies.id, media.id), eq(movies.isPublished, true)))
      .limit(1);
    return Boolean(row);
  }
  m = /^\/tv\/([^/]+)$/.exec(path);
  if (m) {
    const media = parseMediaId(m[1]);
    if (!media) return false;
    if (media.kind === "tmdb") return true;
    const [row] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(and(eq(shows.id, media.id), eq(shows.isPublished, true)))
      .limit(1);
    return Boolean(row);
  }
  m = /^\/watch\/tv\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
  if (m) {
    const season = parseNumber(m[2], 1000);
    const episode = parseNumber(m[3], 100_000);
    if (season === null || episode === null) return false;
    const media = parseMediaId(m[1]);
    if (!media) return false;
    if (media.kind === "tmdb") return true;
    const [row] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .innerJoin(shows, eq(shows.id, seasons.showId))
      .where(
        and(
          eq(shows.id, media.id),
          eq(shows.isPublished, true),
          eq(seasons.seasonNumber, season),
          eq(seasons.isVisible, true),
          eq(episodes.episodeNumber, episode),
          eq(episodes.isVisible, true),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
  return null;
}
