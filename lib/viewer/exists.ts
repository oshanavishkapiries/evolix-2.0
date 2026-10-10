import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, movies, seasons, shows } from "@/db/schema";
import { isUuid, parseNumber } from "./ids";

/**
 * Cheap visibility check used by the proxy so missing/unpublished/hidden titles get a real
 * HTTP 404 (pages stream under Cache Components, which fixes the status at 200).
 * Returns null for paths that are not a title route.
 */
export async function titleRouteVisible(pathname: string): Promise<boolean | null> {
  const path = pathname.replace(/\/+$/, "");
  let m = /^(?:\/watch)?\/movie\/([^/]+)$/.exec(path);
  if (m) {
    if (!isUuid(m[1])) return false;
    const [row] = await db
      .select({ id: movies.id })
      .from(movies)
      .where(and(eq(movies.id, m[1]), eq(movies.isPublished, true)))
      .limit(1);
    return Boolean(row);
  }
  m = /^\/tv\/([^/]+)$/.exec(path);
  if (m) {
    if (!isUuid(m[1])) return false;
    const [row] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(and(eq(shows.id, m[1]), eq(shows.isPublished, true)))
      .limit(1);
    return Boolean(row);
  }
  m = /^\/watch\/tv\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
  if (m) {
    const season = parseNumber(m[2], 1000);
    const episode = parseNumber(m[3], 100_000);
    if (!isUuid(m[1]) || season === null || episode === null) return false;
    const [row] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .innerJoin(shows, eq(shows.id, seasons.showId))
      .where(
        and(
          eq(shows.id, m[1]),
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
