import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute, parseQuery } from "@/lib/cms/api";
import { parentQuery, sourceCreate } from "@/lib/cms/schemas";

export const GET = adminRoute(async (req) => {
  const q = parseQuery(req, parentQuery);
  if ("error" in q) return q.error;
  const { movieId, episodeId } = q.data;
  const where = movieId
    ? and(eq(sources.movieId, movieId), isNull(sources.episodeId))
    : and(eq(sources.episodeId, episodeId!), isNull(sources.movieId));
  const rows = await db.select().from(sources).where(where).orderBy(asc(sources.sortOrder), asc(sources.createdAt));
  return json(200, { sources: rows });
});

// A missing parent surfaces as a foreign-key violation, mapped to 404 by adminRoute.
export const POST = adminRoute(async (req) => {
  const body = await parseBody(req, sourceCreate);
  if ("error" in body) return body.error;
  const [row] = await db.insert(sources).values(body.data).returning();
  return json(201, { source: row });
});
