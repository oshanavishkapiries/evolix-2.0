import { NextRequest } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
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

  const visible = kind === "movie"
    ? sql`select ${movies.id} as id from ${movies} where ${movies.id} = ${id} and ${movies.isPublished} = true`
    : sql`select ${episodes.id} as id from ${episodes}
        inner join ${seasons} on ${seasons.id} = ${episodes.seasonId}
        inner join ${shows} on ${shows.id} = ${seasons.showId}
        where ${episodes.id} = ${id} and ${shows.isPublished} = true
          and ${seasons.isVisible} = true and ${episodes.isVisible} = true`;
  const target = kind === "movie" ? sql`movie_id` : sql`episode_id`;
  const result = await db.execute(sql`
    insert into ${watchProgress} (user_id, ${target}, position_seconds, duration_seconds, completed, updated_at)
    select ${auth.userId}::uuid, visible.id, ${position}, ${duration}, ${completed}, now()
    from (${visible}) visible where true
    on conflict (user_id, ${target}) do update set
      position_seconds = excluded.position_seconds, duration_seconds = excluded.duration_seconds,
      completed = excluded.completed, updated_at = excluded.updated_at
    returning completed`);
  if (!result.rows.length) return fail(404, "NOT_FOUND", "Title not found");
  return json(200, { completed });
}

const clearBody = z.object({ kind: z.enum(["movie", "episode", "show"]), id: z.uuid() });

/** Clears the caller's saved progress for a movie, an episode, or every episode of a show. */
export async function DELETE(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const parsed = await parseBody(req, clearBody);
  if ("error" in parsed) return parsed.error;
  const { kind, id } = parsed.data;
  const mine = eq(watchProgress.userId, auth.userId);
  if (kind === "movie") await db.delete(watchProgress).where(and(mine, eq(watchProgress.movieId, id)));
  else if (kind === "episode") await db.delete(watchProgress).where(and(mine, eq(watchProgress.episodeId, id)));
  else {
    const eps = db
      .select({ id: episodes.id })
      .from(episodes)
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .where(eq(seasons.showId, id));
    await db.delete(watchProgress).where(and(mine, inArray(watchProgress.episodeId, eps)));
  }
  return json(200, { cleared: true });
}
