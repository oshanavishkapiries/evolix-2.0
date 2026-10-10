import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { movies, shows } from "@/db/schema";
import { json } from "@/lib/auth/http";
import { adminRoute, parseQuery } from "@/lib/cms/api";
import { searchMovies, searchShows } from "@/lib/tmdb";

const query = z.object({
  type: z.enum(["movie", "tv"]),
  query: z.string().trim().min(1).max(200),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

export const GET = adminRoute(async (req) => {
  const q = parseQuery(req, query);
  if ("error" in q) return q.error;
  const { type, query: text, page } = q.data;

  const found = type === "movie" ? await searchMovies(text, page) : await searchShows(text, page);
  const ids = found.results.map((r) => r.tmdbId);
  const table = type === "movie" ? movies : shows;
  const existing = ids.length
    ? await db
        .select({ id: table.id, tmdbId: table.tmdbId })
        .from(table)
        .where(inArray(table.tmdbId, ids))
    : [];
  const localIds = new Map(existing.map((e) => [e.tmdbId, e.id]));

  return json(200, {
    page: found.page,
    totalPages: found.totalPages,
    results: found.results.map((r) => ({
      ...r,
      alreadyAdded: localIds.has(r.tmdbId),
      localId: localIds.get(r.tmdbId) ?? null,
    })),
  });
});
