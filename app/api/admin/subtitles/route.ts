import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { subtitles } from "@/db/schema";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute, parseQuery } from "@/lib/cms/api";
import { parentQuery, subtitleCreate } from "@/lib/cms/schemas";

export const GET = adminRoute(async (req) => {
  const q = parseQuery(req, parentQuery);
  if ("error" in q) return q.error;
  const { movieId, episodeId } = q.data;
  const where = movieId
    ? and(eq(subtitles.movieId, movieId), isNull(subtitles.episodeId))
    : and(eq(subtitles.episodeId, episodeId!), isNull(subtitles.movieId));
  const rows = await db
    .select()
    .from(subtitles)
    .where(where)
    .orderBy(asc(subtitles.sortOrder), asc(subtitles.createdAt));
  return json(200, { subtitles: rows });
});

export const POST = adminRoute(async (req) => {
  const body = await parseBody(req, subtitleCreate);
  if ("error" in body) return body.error;
  const [row] = await db.insert(subtitles).values(body.data).returning();
  return json(201, { subtitle: row });
});
