import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bookmarks, movies, shows } from "@/db/schema";
import { fail, json, parseBody } from "@/lib/auth/http";
import { authenticate } from "@/lib/auth/session";
import { bookmarkIds } from "@/lib/viewer/library";

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  return json(200, await bookmarkIds(auth.userId));
}

const body = z.object({ kind: z.enum(["movie", "show"]), id: z.uuid(), on: z.boolean() });

/** Sets (on) or clears (off) a bookmark; idempotent. */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { kind, id, on } = parsed.data;

  const target = kind === "movie" ? { movieId: id } : { showId: id };
  const col = kind === "movie" ? bookmarks.movieId : bookmarks.showId;
  if (!on) {
    await db.delete(bookmarks).where(and(eq(bookmarks.userId, auth.userId), eq(col, id)));
    return json(200, { bookmarked: false });
  }
  const [title] =
    kind === "movie"
      ? await db.select({ id: movies.id }).from(movies).where(and(eq(movies.id, id), eq(movies.isPublished, true))).limit(1)
      : await db.select({ id: shows.id }).from(shows).where(and(eq(shows.id, id), eq(shows.isPublished, true))).limit(1);
  if (!title) return fail(404, "NOT_FOUND", "Title not found");
  await db.insert(bookmarks).values({ userId: auth.userId, ...target }).onConflictDoNothing();
  return json(200, { bookmarked: true });
}
