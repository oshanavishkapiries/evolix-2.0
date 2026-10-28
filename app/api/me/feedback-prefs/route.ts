import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { feedbackPrefs } from "@/db/schema";
import { fail, json, parseBody } from "@/lib/auth/http";
import { authenticate } from "@/lib/auth/session";

/** Whether the caller said "don't ask me" to player questions. */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const [row] = await db.select({ optedOut: feedbackPrefs.optedOut }).from(feedbackPrefs).where(eq(feedbackPrefs.userId, auth.userId)).limit(1);
  return json(200, { optedOut: row?.optedOut ?? false });
}

export async function PUT(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const parsed = await parseBody(req, z.object({ optedOut: z.boolean() }));
  if ("error" in parsed) return parsed.error;
  const { optedOut } = parsed.data;
  await db.insert(feedbackPrefs).values({ userId: auth.userId, optedOut }).onConflictDoUpdate({ target: feedbackPrefs.userId, set: { optedOut, updatedAt: new Date() } });
  return json(200, { optedOut });
}
