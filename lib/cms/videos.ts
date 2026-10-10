import { and, asc, eq, isNull, max } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import type { VideoNested } from "./schemas";

type Parent = { movieId: string } | { showId: string };

export async function listVideos(parent: Parent) {
  const where =
    "movieId" in parent
      ? and(eq(videos.movieId, parent.movieId), isNull(videos.showId))
      : and(eq(videos.showId, parent.showId), isNull(videos.movieId));
  return db.select().from(videos).where(where).orderBy(asc(videos.sortOrder), asc(videos.createdAt));
}

/** Rows ready for insert; duplicate site+key entries collapse to the first. */
export function videoRows(parent: Parent, input: VideoNested[], startAt = 0) {
  const seen = new Set<string>();
  const rows: (typeof videos.$inferInsert)[] = [];
  for (const v of input) {
    const k = `${v.site}:${v.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({
      ...parent,
      site: v.site,
      key: v.key,
      name: v.name,
      type: v.type,
      official: v.official,
      language: v.language,
      publishedAt: v.publishedAt ? new Date(v.publishedAt) : null,
      sortOrder: startAt + v.sortOrder,
      isVisible: v.isVisible,
    });
  }
  return rows;
}

/** Inserts videos for a parent, skipping ones that already exist. Returns the number added. */
export async function addVideos(parent: Parent, input: VideoNested[]) {
  const [{ top }] = await db
    .select({ top: max(videos.sortOrder) })
    .from(videos)
    .where("movieId" in parent ? eq(videos.movieId, parent.movieId) : eq(videos.showId, parent.showId));
  const rows = videoRows(parent, input, top === null ? 0 : top + 1);
  if (!rows.length) return 0;
  const inserted = await db.insert(videos).values(rows).onConflictDoNothing().returning({ id: videos.id });
  return inserted.length;
}
