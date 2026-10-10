import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subtitles } from "@/db/schema";
import { json } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound, parsePatch } from "@/lib/cms/api";
import { subtitlePatch } from "@/lib/cms/schemas";

type P = { id: string };

export const PATCH = adminRoute<P>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Subtitle");
  const body = await parsePatch(req, subtitlePatch);
  if ("error" in body) return body.error;
  const [row] = await db.update(subtitles).set(body.data).where(eq(subtitles.id, id)).returning();
  return row ? json(200, { subtitle: row }) : notFound("Subtitle");
});

export const DELETE = adminRoute<P>(async (_req, { id }) => {
  if (!isUuid(id)) return notFound("Subtitle");
  const rows = await db.delete(subtitles).where(eq(subtitles.id, id)).returning({ id: subtitles.id });
  return rows.length ? json(200, {}) : notFound("Subtitle");
});
