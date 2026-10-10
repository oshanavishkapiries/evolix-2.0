import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { episodes, movies, seasons, shows, watchProgress } from "@/db/schema";
import { fail, json, parseBody } from "@/lib/auth/http";
import { authenticate } from "@/lib/auth/session";
import { COMPLETE_RATIO } from "@/lib/viewer/library";

const MAX_SECONDS = 24 * 3600;
const body = z.object({
  kind: z.enum(["movie", "episode"]),
  id: z.uuid(),
  position: z.number().min(0).max(MAX_SECONDS),
  duration: z.number().min(0).max(MAX_SECONDS),
});

/** Upserts the caller's playback position for a movie or episode. */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { kind, id } = parsed.data;
  const duration = Math.round(parsed.data.duration);
  const position = Math.min(Math.round(parsed.data.position), duration || MAX_SECONDS);
  const completed = duration > 0 && position / duration >= COMPLETE_RATIO;

  const visible =
    kind === "movie"
      ? await db.select({ id: movies.id }).from(movies).where(and(eq(movies.id, id), eq(movies.isPublished, true))).limit(1)
      : await db
          .select({ id: episodes.id })
          .from(episodes)
          .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
          .innerJoin(shows, eq(shows.id, seasons.showId))
          .where(and(eq(episodes.id, id), eq(shows.isPublished, true)))
          .limit(1);
  if (!visible.length) return fail(404, "NOT_FOUND", "Title not found");

  const values = {
    userId: auth.userId,
    ...(kind === "movie" ? { movieId: id } : { episodeId: id }),
    positionSeconds: position,
    durationSeconds: duration,
    completed,
    updatedAt: new Date(),
  };
  await db
    .insert(watchProgress)
    .values(values)
    .onConflictDoUpdate({
      target: kind === "movie" ? [watchProgress.userId, watchProgress.movieId] : [watchProgress.userId, watchProgress.episodeId],
      set: { positionSeconds: position, durationSeconds: duration, completed, updatedAt: values.updatedAt },
    });
  return json(200, { completed });
}
