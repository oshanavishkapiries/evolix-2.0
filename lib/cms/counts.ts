import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, sources, subtitles, videos } from "@/db/schema";

const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;

/** What deleting a movie removes (cascade), for the confirm dialog. */
export async function movieCounts(id: string) {
  const [s, sub, v] = await Promise.all([
    db.select({ n: count() }).from(sources).where(eq(sources.movieId, id)),
    db.select({ n: count() }).from(subtitles).where(eq(subtitles.movieId, id)),
    db.select({ n: count() }).from(videos).where(eq(videos.movieId, id)),
  ]);
  return { sources: n(s), subtitles: n(sub), videos: n(v) };
}

/** What deleting a show removes (cascade), for the confirm dialog. */
export async function showCounts(id: string) {
  const [se, ep, so, su, v] = await Promise.all([
    db.select({ n: count() }).from(seasons).where(eq(seasons.showId, id)),
    db.select({ n: count() }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).where(eq(seasons.showId, id)),
    db
      .select({ n: count() })
      .from(sources)
      .innerJoin(episodes, eq(sources.episodeId, episodes.id))
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(eq(seasons.showId, id)),
    db
      .select({ n: count() })
      .from(subtitles)
      .innerJoin(episodes, eq(subtitles.episodeId, episodes.id))
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(eq(seasons.showId, id)),
    db.select({ n: count() }).from(videos).where(eq(videos.showId, id)),
  ]);
  return { seasons: n(se), episodes: n(ep), sources: n(so), subtitles: n(su), videos: n(v) };
}
