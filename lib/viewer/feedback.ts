import "server-only";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { episodes, movies, playerFeedback } from "@/db/schema";
import { FEEDBACK_COOLDOWN_DAYS } from "@/lib/feedback";
import { getSetting } from "@/lib/settings";

/** Survey on, no answer from this user in the cooldown window, and never one for this title. */
export async function feedbackEligible(userId: string, mediaKey: string) {
  if (!(await getSetting("playerFeedback"))) return false;
  const [row] = await db
    .select({ id: playerFeedback.id })
    .from(playerFeedback)
    .where(
      and(
        eq(playerFeedback.userId, userId),
        or(gt(playerFeedback.createdAt, sql`now() - make_interval(days => ${FEEDBACK_COOLDOWN_DAYS})`), eq(playerFeedback.mediaKey, mediaKey)),
      ),
    )
    .limit(1);
  return !row;
}

/** The catalog row behind a progress target, or nulls when it is not (or no longer) in the database. */
export async function feedbackTarget(track: { kind: "movie" | "episode"; id: string } | undefined) {
  if (!track) return { movieId: null, episodeId: null };
  if (track.kind === "movie") {
    const [m] = await db.select({ id: movies.id }).from(movies).where(eq(movies.id, track.id)).limit(1);
    return { movieId: m?.id ?? null, episodeId: null };
  }
  const [e] = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.id, track.id)).limit(1);
  return { movieId: null, episodeId: e?.id ?? null };
}
