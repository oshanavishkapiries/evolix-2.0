import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { subtitles, subtitleGrants } from "@/db/schema";
import { tokenKey } from "@/lib/subtitles/keys";
import { json, parseBody } from "@/lib/auth/http";
import { subtitleRoute } from "@/lib/subtitles/http";
import { publicTrack } from "@/lib/subtitles/store";

export const POST = subtitleRoute(async (req, userId) => {
  const body = await parseBody(req, z.union([z.object({ trackId: z.uuid() }), z.object({ invite: z.string().max(2000) })]));
  if ("error" in body) return body.error;
  const key = (await tokenKey());
  if ("trackId" in body.data) {
    const [track] = await db.select().from(subtitles).where(eq(subtitles.id, body.data.trackId)).limit(1);
    if (!track || track.uploadedBy !== userId || track.hidden || track.source !== "upload") return json(404, { message: "Your uploaded subtitle was not found" });
    const invite = await new SignJWT({ trackId: track.id }).setProtectedHeader({ alg: "HS256" }).setAudience("subtitle-invite").setSubject(userId).setExpirationTime("7d").sign(key);
    return json(200, { invite });
  }
  let trackId: string, owner: string;
  try {
    const { payload } = await jwtVerify(body.data.invite, key, { algorithms: ["HS256"], audience: "subtitle-invite" });
    trackId = z.uuid().parse(payload.trackId); owner = z.uuid().parse(payload.sub);
  } catch { return json(400, { message: "Subtitle invitation expired or is invalid" }); }
  const [track] = await db.select().from(subtitles).where(eq(subtitles.id, trackId)).limit(1);
  if (!track || track.uploadedBy !== owner || track.hidden) return json(404, { message: "Subtitle is no longer available" });
  await db.insert(subtitleGrants).values({ trackId, userId }).onConflictDoNothing();
  return json(200, { track: await publicTrack(track, userId) });
}, 20);
