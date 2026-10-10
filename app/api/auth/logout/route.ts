export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { clearAuthCookies, json } from "@/lib/auth/http";
import { refreshSessionId, revokeSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const sessionId = await refreshSessionId(req);
  if (sessionId) await revokeSession(sessionId);
  return clearAuthCookies(json(200, { message: "Logged out" }));
}
