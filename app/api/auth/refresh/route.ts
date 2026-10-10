export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { clearAuthCookies, clientInfo, fail, json, REFRESH_COOKIE, setAuthCookies } from "@/lib/auth/http";
import { rotateSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(REFRESH_COOKIE)?.value;
  const result = token ? await rotateSession(token, clientInfo(req)) : { status: "invalid" as const };

  if (result.status !== "ok") {
    return clearAuthCookies(fail(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token"));
  }
  return setAuthCookies(json(200, { message: "Refreshed" }), result.access, result.refresh);
}
