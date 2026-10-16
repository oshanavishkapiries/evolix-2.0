import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bookmarks, movies, shows } from "@/db/schema";
import { ensureMovie, ensureShow } from "@/lib/evo/ensure";
import { TmdbError } from "@/lib/tmdb";
import { fail, json, parseBody } from "@/lib/auth/http";
import { authenticate } from "@/lib/auth/session";
import { bookmarkIds } from "@/lib/viewer/library";

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  return json(200, await bookmarkIds(auth.userId));
}

// A row id, or "tmdb-N" for an Evo title that has no catalog row yet (created on demand).
const body = z.object({ kind: z.enum(["movie", "show"]), id: z.union([z.uuid(), z.string().regex(/^tmdb-\d{1,9}$/)]), on: z.boolean() });

/** Row id plus both id forms (row id, "tmdb-N") the client may know the title by. */
async function resolve(kind: "movie" | "show", id: string, create: boolean) {
  const table = kind === "movie" ? movies : shows;
  const match = id.startsWith("tmdb-") ? eq(table.tmdbId, Number(id.slice(5))) : eq(table.id, id);
  let [row] = await db.select({ id: table.id, tmdbId: table.tmdbId }).from(table).where(and(match, eq(table.isPublished, true))).limit(1);
  if (!row && create && id.startsWith("tmdb-")) {
    const tmdbId = Number(id.slice(5));
    const rowId = kind === "movie" ? await ensureMovie(tmdbId) : await ensureShow(tmdbId);
    row = { id: rowId, tmdbId };
  }
  return row ? { rowId: row.id, ids: [row.id, `tmdb-${row.tmdbId}`] } : null;
}

/** Sets (on) or clears (off) a bookmark; idempotent. */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { kind, id, on } = parsed.data;

  const col = kind === "movie" ? bookmarks.movieId : bookmarks.showId;
  let title;
  try {
    title = await resolve(kind, id, on);
  } catch (e) {
    if (e instanceof TmdbError) return fail(404, "NOT_FOUND", "Title not found");
    throw e;
  }
  if (!title) return on ? fail(404, "NOT_FOUND", "Title not found") : json(200, { bookmarked: false, ids: [id] });
  if (!on) {
    await db.delete(bookmarks).where(and(eq(bookmarks.userId, auth.userId), eq(col, title.rowId)));
    return json(200, { bookmarked: false, ids: title.ids });
  }
  await db.insert(bookmarks).values({ userId: auth.userId, ...(kind === "movie" ? { movieId: title.rowId } : { showId: title.rowId }) }).onConflictDoNothing();
  return json(200, { bookmarked: true, ids: title.ids });
}
