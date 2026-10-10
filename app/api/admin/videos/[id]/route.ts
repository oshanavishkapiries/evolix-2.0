import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { fail, json } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound, parsePatch } from "@/lib/cms/api";
import { VIDEO_KEY_ERROR, videoPatch } from "@/lib/cms/schemas";
import { isValidKey } from "@/lib/videos";

type P = { id: string };

export const PATCH = adminRoute<P>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Video");
  const body = await parsePatch(req, videoPatch);
  if ("error" in body) return body.error;

  const [current] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
  if (!current) return notFound("Video");
  const next = { ...current, ...body.data };
  if (!isValidKey(next.site, next.key)) {
    return fail(400, "VALIDATION_ERROR", "Invalid request", {
      issues: [{ path: "key", message: VIDEO_KEY_ERROR }],
    });
  }
  const { publishedAt, ...rest } = body.data;
  const set: Partial<typeof videos.$inferInsert> = rest;
  if (publishedAt !== undefined) set.publishedAt = publishedAt ? new Date(publishedAt) : null;
  // A clash with another video of the same parent is a unique violation (409).
  const [row] = await db.update(videos).set(set).where(eq(videos.id, id)).returning();
  return json(200, { video: row });
});

export const DELETE = adminRoute<P>(async (_req, { id }) => {
  if (!isUuid(id)) return notFound("Video");
  const rows = await db.delete(videos).where(eq(videos.id, id)).returning({ id: videos.id });
  return rows.length ? json(200, {}) : notFound("Video");
});
