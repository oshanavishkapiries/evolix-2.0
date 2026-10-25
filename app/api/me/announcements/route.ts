import { NextRequest } from "next/server";
import { fail, json } from "@/lib/auth/http";
import { authenticate } from "@/lib/auth/session";
import { inboxFor } from "@/lib/viewer/announcements";

/** The signed-in user's inbox: announcements addressed to them that are live now, newest first. */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const res = json(200, await inboxFor(auth.userId));
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
