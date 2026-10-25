import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, json, parseBody } from "@/lib/auth/http";
import { authenticate } from "@/lib/auth/session";
import { markRead } from "@/lib/viewer/announcements";

const body = z.union([z.object({ id: z.uuid() }), z.object({ all: z.literal(true) })]);

/** Marks one announcement, or all unread ones, as read for the signed-in user. Idempotent. */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  await markRead(auth.userId, parsed.data);
  return json(200, { read: true });
}
