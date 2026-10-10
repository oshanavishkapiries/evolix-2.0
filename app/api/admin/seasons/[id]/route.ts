import { eq } from "drizzle-orm";
import { db } from "@/db";
import { seasons } from "@/db/schema";
import { json } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound, parsePatch } from "@/lib/cms/api";
import { seasonPatch } from "@/lib/cms/schemas";

type P = { id: string };

export const PATCH = adminRoute<P>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Season");
  const body = await parsePatch(req, seasonPatch);
  if ("error" in body) return body.error;
  const [row] = await db.update(seasons).set(body.data).where(eq(seasons.id, id)).returning();
  return row ? json(200, { season: row }) : notFound("Season");
});

export const DELETE = adminRoute<P>(async (_req, { id }) => {
  if (!isUuid(id)) return notFound("Season");
  const rows = await db.delete(seasons).where(eq(seasons.id, id)).returning({ id: seasons.id });
  return rows.length ? json(200, {}) : notFound("Season");
});
