import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { fail, json, parseBody } from "@/lib/auth/http";
import { allow, viewerId } from "@/lib/evo/guard";
import { pixeldrainId, pixeldrainInfoUrl } from "@/lib/viewer/providers";
import { CATALOG_TAG } from "@/lib/viewer/cache";

const body = z.object({ sourceId: z.uuid() });

/**
 * The player could not play a CDN source. If the CDN confirms the file is gone, deactivate the source so the
 * title falls back to another quality or to a fresh Evo ingest. A viewer's say-so alone never disables a source.
 */
export async function POST(req: NextRequest) {
  const userId = await viewerId(req);
  if (!userId) return fail(401, "UNAUTHORIZED", "Not authenticated");
  if (!allow(`heal:${userId}`, 20, 10 * 60_000)) return fail(429, "RATE_LIMITED", "Too many reports");
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;

  const [source] = await db.select({ id: sources.id, url: sources.url, isActive: sources.isActive }).from(sources).where(eq(sources.id, parsed.data.sourceId)).limit(1);
  const fileId = source ? pixeldrainId(source.url) : null;
  if (!source || !fileId) return json(200, { healed: false });
  if (!source.isActive) return json(200, { healed: true });

  let gone = false;
  try {
    const res = await fetch(pixeldrainInfoUrl(fileId), { signal: AbortSignal.timeout(8000), cache: "no-store" });
    gone = res.status === 404 || res.status === 410;
  } catch {
    // Network trouble is not proof the file is gone.
  }
  if (!gone) return json(200, { healed: false });

  await db.update(sources).set({ isActive: false }).where(eq(sources.id, source.id));
  revalidateTag(CATALOG_TAG, { expire: 0 });
  return json(200, { healed: true });
}
