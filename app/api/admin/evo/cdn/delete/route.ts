import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute, notFound } from "@/lib/cms/api";
import { engineProxy } from "@/lib/cms/evo-admin";

const body = z.union([z.object({ sourceId: z.uuid() }), z.object({ url: z.string().url().max(500) })]);

/**
 * Deletes a file from the CDN account. With `sourceId` the catalog source row is removed too, so viewers fall
 * back to another quality or a fresh ingest; with a bare `url` (an orphan file) only the file is deleted.
 */
export const POST = adminRoute(async (req) => {
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  let url: string;
  if ("sourceId" in parsed.data) {
    const [row] = await db.select({ url: sources.url }).from(sources).where(eq(sources.id, parsed.data.sourceId)).limit(1);
    if (!row) return notFound("Source");
    url = row.url;
  } else {
    url = parsed.data.url;
  }
  const res = await engineProxy("POST", "/cdn/delete", { url });
  if (!res.ok) return res;
  if ("sourceId" in parsed.data) await db.delete(sources).where(eq(sources.id, parsed.data.sourceId));
  return json(200, {});
});
