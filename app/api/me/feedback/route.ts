import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { playerFeedback } from "@/db/schema";
import { clientInfo, fail, json, parseBody } from "@/lib/auth/http";
import { authenticate } from "@/lib/auth/session";
import { feedbackEligible, feedbackTarget } from "@/lib/viewer/feedback";

const mediaKey = z.string().min(1).max(200);

/** Whether the survey may be shown for this title now (setting, cooldown, already answered). */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const key = mediaKey.safeParse(req.nextUrl.searchParams.get("key"));
  if (!key.success) return fail(400, "VALIDATION_ERROR", "Missing key");
  return json(200, { eligible: await feedbackEligible(auth.userId, key.data) });
}

const body = z.object({
  mediaKey,
  title: z.string().min(1).max(300),
  rating: z.number().int().min(1).max(5),
  track: z.object({ kind: z.enum(["movie", "episode"]), id: z.uuid() }).optional(),
  position: z.number().min(0).max(86_400).optional(),
  duration: z.number().min(0).max(86_400).optional(),
  quality: z.string().max(20).nullish(),
  stalls: z.number().int().min(0).max(10_000).optional(),
  trigger: z.enum(["pause", "ended", "playing"]).optional(),
});

/** Records the emoji tap. Tags and a comment can follow with PATCH /api/me/feedback/:id. */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  if (!(await feedbackEligible(auth.userId, d.mediaKey))) return fail(429, "TOO_SOON", "Feedback was given recently");
  const target = await feedbackTarget(d.track);
  const [row] = await db
    .insert(playerFeedback)
    .values({
      userId: auth.userId,
      ...target,
      mediaKey: d.mediaKey,
      title: d.title,
      rating: d.rating,
      positionSeconds: d.position === undefined ? null : Math.round(d.position),
      durationSeconds: d.duration === undefined ? null : Math.round(d.duration),
      quality: d.quality ?? null,
      stalls: d.stalls ?? null,
      trigger: d.trigger ?? null,
      userAgent: clientInfo(req).userAgent,
    })
    .returning({ id: playerFeedback.id });
  return json(201, { id: row.id });
}
