import "server-only";
import { and, count, desc, eq, gt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { episodes, feedbackAsks, feedbackPrefs, feedbackQuestions, movies, playerFeedback } from "@/db/schema";
import { BUDGET, FEEDBACK_COOLDOWN_DAYS, type Ask, type Moment, type QuestionKind } from "@/lib/feedback";
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

const DAY = 86_400_000;
type Context = Record<string, string | number | boolean | null>;

/** Why no question was asked (for tests and logs), or the question that was. */
export type Pick = { ask: Ask } | { ask: null; reason: "off" | "opted_out" | "gap" | "weekly" | "ignored" | "none" | "sampled_out" };

/**
 * Whether the player may ask this viewer something for `moment` now, and what. Checks the shared budget first
 * (setting, opt-out, gap, weekly cap, ignore back-off), then the moment's active questions by priority: one this
 * viewer has not seen (per title for "title" questions), still short of its target, and in its random sample.
 * The chosen question is recorded as shown right away, so it counts against the budget even if never answered.
 */
export async function pickQuestion(userId: string, moment: Moment, media: { key: string; title: string }, context: Context = {}, random: () => number = Math.random, now = Date.now()): Promise<Pick> {
  if (!(await getSetting("playerFeedback"))) return { ask: null, reason: "off" };
  const [prefs] = await db.select({ optedOut: feedbackPrefs.optedOut }).from(feedbackPrefs).where(eq(feedbackPrefs.userId, userId)).limit(1);
  if (prefs?.optedOut) return { ask: null, reason: "opted_out" };

  const since = new Date(now - BUDGET.backoffDays * DAY);
  const recent = await db
    .select({ outcome: feedbackAsks.outcome, at: feedbackAsks.createdAt })
    .from(feedbackAsks)
    .where(and(eq(feedbackAsks.userId, userId), gt(feedbackAsks.createdAt, since)))
    .orderBy(desc(feedbackAsks.createdAt))
    .limit(20);
  const ageDays = (at: Date) => (now - at.getTime()) / DAY;
  // Answers to the survey from before this budget existed count as asks too.
  const [legacy] = await db.select({ at: playerFeedback.createdAt }).from(playerFeedback).where(eq(playerFeedback.userId, userId)).orderBy(desc(playerFeedback.createdAt)).limit(1);
  if (recent.some((r) => ageDays(r.at) < BUDGET.gapDays) || (legacy && ageDays(legacy.at) < BUDGET.gapDays)) return { ask: null, reason: "gap" };
  if (recent.filter((r) => ageDays(r.at) < 7).length >= BUDGET.weeklyMax) return { ask: null, reason: "weekly" };
  const streak = recent.slice(0, BUDGET.ignoreStreak);
  if (streak.length === BUDGET.ignoreStreak && streak.every((r) => r.outcome === "ignored")) return { ask: null, reason: "ignored" };

  const questions = await db.select().from(feedbackQuestions).where(and(eq(feedbackQuestions.moment, moment), eq(feedbackQuestions.active, true))).orderBy(desc(feedbackQuestions.priority));
  let sampledOut = false;
  for (const q of questions) {
    const seen = await db
      .select({ id: feedbackAsks.id })
      .from(feedbackAsks)
      .where(and(eq(feedbackAsks.userId, userId), eq(feedbackAsks.questionKey, q.key), q.once === "title" ? eq(feedbackAsks.mediaKey, media.key) : undefined))
      .limit(1);
    if (seen.length) continue;
    if (q.key === "experience") {
      const [answered] = await db.select({ id: playerFeedback.id }).from(playerFeedback).where(and(eq(playerFeedback.userId, userId), eq(playerFeedback.mediaKey, media.key))).limit(1);
      if (answered) continue;
    }
    if (q.target !== null) {
      const [{ n }] = await db.select({ n: count() }).from(feedbackAsks).where(and(eq(feedbackAsks.questionKey, q.key), eq(feedbackAsks.outcome, "answered")));
      if (n >= q.target) continue;
    }
    if (random() * 100 >= q.sampleRate) {
      sampledOut = true;
      continue;
    }
    const [row] = await db.insert(feedbackAsks).values({ questionKey: q.key, userId, mediaKey: media.key, title: media.title, context }).returning({ id: feedbackAsks.id });
    return { ask: { id: row.id, key: q.key, kind: q.kind as QuestionKind, prompt: q.prompt, reasons: q.reasons } };
  }
  return { ask: null, reason: sampledOut ? "sampled_out" : "none" };
}
