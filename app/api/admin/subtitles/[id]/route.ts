import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { subtitles } from "@/db/schema";
import { json } from "@/lib/auth/http";
import { adminRoute, isUuid, notFound, parsePatch } from "@/lib/cms/api";
import { subtitlePatch } from "@/lib/cms/schemas";
import { defaultEngine, engineById } from "@/lib/evo/client";
import { engineProxy } from "@/lib/cms/evo-admin";
import { pixeldrainId } from "@/lib/viewer/providers";

type P = { id: string };

export const PATCH = adminRoute<P>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Subtitle");
  const body = await parsePatch(req, subtitlePatch);
  if ("error" in body) return body.error;
  const [row] = await db.update(subtitles).set(body.data).where(eq(subtitles.id, id)).returning();
  return row ? json(200, { subtitle: row }) : notFound("Subtitle");
});

export const DELETE = adminRoute<P>(async (req, { id }) => {
  if (!isUuid(id)) return notFound("Subtitle");
  const [track] = await db.select().from(subtitles).where(eq(subtitles.id, id)).limit(1);
  if (!track) return notFound("Subtitle");
  const children = await db.select().from(subtitles).where(eq(subtitles.originTrackId, id));
  const deleting = [track, ...children];
  // ?force=1 removes only the database rows, for a CDN file the engine can no longer delete (already gone).
  const force = req.nextUrl.searchParams.get("force") === "1";
  for (const sub of deleting) {
    if (force || !pixeldrainId(sub.url)) continue;
    const shared = await db.select({ id: subtitles.id }).from(subtitles).where(and(eq(subtitles.url, sub.url), notInArray(subtitles.id, deleting.map((s) => s.id)))).limit(1);
    if (shared.length) continue;
    const engine = sub.engineId ? engineById(sub.engineId) : defaultEngine();
    if (!engine) return json(503, { message: "The engine that owns this subtitle must be configured before deleting its CDN file" });
    const res = await engineProxy("POST", "/cdn/delete", { url: sub.url }, engine);
    if (!res.ok) return res;
  }
  const rows = await db.delete(subtitles).where(eq(subtitles.id, id)).returning({ id: subtitles.id });
  return rows.length ? json(200, {}) : notFound("Subtitle");
});
