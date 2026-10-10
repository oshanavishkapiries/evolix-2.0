import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { fail, json } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound, parsePatch } from "@/lib/cms/api";
import { EMBED_ERROR, embedIsHttps, sourcePatch } from "@/lib/cms/schemas";

type P = { id: string };

export const PATCH = adminRoute<P>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Source");
  const body = await parsePatch(req, sourcePatch);
  if ("error" in body) return body.error;

  const [current] = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
  if (!current) return notFound("Source");
  const next = { ...current, ...body.data };
  if (!embedIsHttps(next.kind, next.url)) {
    return fail(400, "VALIDATION_ERROR", "Invalid request", {
      issues: [{ path: "url", message: EMBED_ERROR }],
    });
  }
  const [row] = await db.update(sources).set(body.data).where(eq(sources.id, id)).returning();
  return json(200, { source: row });
});

export const DELETE = adminRoute<P>(async (_req, { id }) => {
  if (!isUuid(id)) return notFound("Source");
  const rows = await db.delete(sources).where(eq(sources.id, id)).returning({ id: sources.id });
  return rows.length ? json(200, {}) : notFound("Source");
});
