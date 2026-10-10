export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { clearAuthCookies, fail, json } from "@/lib/auth/http";
import { authenticate, revokeAllSessions } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  await revokeAllSessions(auth.userId);
  return clearAuthCookies(json(200, { message: "Logged out of all devices" }));
}
