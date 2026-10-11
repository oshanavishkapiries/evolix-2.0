import { NextRequest } from "next/server";
import { and, count, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { episodes, movies, reports, seasons, shows } from "@/db/schema";
import { fail, json, parseBody } from "@/lib/auth/http";
import { authenticate } from "@/lib/auth/session";
import { MESSAGE_MAX, OTHER_MIN, REASON_KEYS } from "@/lib/reports";

const DAY_MS = 24 * 3600 * 1000;
const MAX_PER_DAY = 20;

const body = z.object({
  kind: z.enum(["movie", "show", "episode"]),
  id: z.uuid(),
  reason: z.enum(REASON_KEYS),
  message: z.string().trim().max(MESSAGE_MAX).default(""),
});

/** Files a report about a published movie, show or episode. A repeat of the same open report is a no-op. */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { kind, id, reason, message } = parsed.data;
  if (reason === "other" && message.length < OTHER_MIN) {
    return fail(400, "VALIDATION_ERROR", "Invalid request", {
      issues: [{ path: "message", message: `Please describe the problem (at least ${OTHER_MIN} characters)` }],
    });
  }

  const visible =
    kind === "movie"
      ? await db.select({ id: movies.id }).from(movies).where(and(eq(movies.id, id), eq(movies.isPublished, true))).limit(1)
      : kind === "show"
        ? await db.select({ id: shows.id }).from(shows).where(and(eq(shows.id, id), eq(shows.isPublished, true))).limit(1)
        : await db
            .select({ id: episodes.id })
            .from(episodes)
            .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
            .innerJoin(shows, eq(shows.id, seasons.showId))
            .where(and(eq(episodes.id, id), eq(shows.isPublished, true)))
            .limit(1);
  if (!visible.length) return fail(404, "NOT_FOUND", "Title not found");

  const target = kind === "movie" ? { movieId: id } : kind === "show" ? { showId: id } : { episodeId: id };
  const col = kind === "movie" ? reports.movieId : kind === "show" ? reports.showId : reports.episodeId;
  const since = new Date(Date.now() - DAY_MS);

  const [dup] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.userId, auth.userId), eq(col, id), eq(reports.reason, reason), eq(reports.status, "open")))
    .limit(1);
  if (dup) return json(200, { reported: true, duplicate: true });

  const [{ n }] = await db
    .select({ n: count() })
    .from(reports)
    .where(and(eq(reports.userId, auth.userId), gt(reports.createdAt, since)));
  if (n >= MAX_PER_DAY) return fail(429, "RATE_LIMITED", "You have sent too many reports today. Please try again tomorrow.");

  await db.insert(reports).values({ userId: auth.userId, ...target, reason, message });
  return json(201, { reported: true });
}
