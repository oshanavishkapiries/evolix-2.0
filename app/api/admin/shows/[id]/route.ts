import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shows } from "@/db/schema";
import { json } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound, parsePatch } from "@/lib/cms/api";
import { showPatch } from "@/lib/cms/schemas";
import { getShowTree } from "@/lib/cms/shows";

type P = { id: string };

export const GET = adminRoute<P>(async (_req, { id }) => {
  const show = isUuid(id) ? await getShowTree(id) : null;
  return show ? json(200, { show }) : notFound("Show");
});

export const PATCH = adminRoute<P>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Show");
  const body = await parsePatch(req, showPatch);
  if ("error" in body) return body.error;
  const [row] = await db
    .update(shows)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(shows.id, id))
    .returning();
  return row ? json(200, { show: row }) : notFound("Show");
});

// Seasons, episodes, sources and subtitles are removed by ON DELETE CASCADE.
export const DELETE = adminRoute<P>(async (_req, { id }) => {
  if (!isUuid(id)) return notFound("Show");
  const rows = await db.delete(shows).where(eq(shows.id, id)).returning({ id: shows.id });
  return rows.length ? json(200, {}) : notFound("Show");
});
