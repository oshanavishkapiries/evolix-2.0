import { eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes } from "@/db/schema";
import { json } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound, parsePatch } from "@/lib/cms/api";
import { episodePatch } from "@/lib/cms/schemas";

type P = { id: string };

export const PATCH = adminRoute<P>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Episode");
  const body = await parsePatch(req, episodePatch);
  if ("error" in body) return body.error;
  const [row] = await db.update(episodes).set(body.data).where(eq(episodes.id, id)).returning();
  return row ? json(200, { episode: row }) : notFound("Episode");
});

export const DELETE = adminRoute<P>(async (_req, { id }) => {
  if (!isUuid(id)) return notFound("Episode");
  const rows = await db.delete(episodes).where(eq(episodes.id, id)).returning({ id: episodes.id });
  return rows.length ? json(200, {}) : notFound("Episode");
});
