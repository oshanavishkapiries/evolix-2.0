import { NextRequest, NextResponse } from "next/server";
import { clearAuthCookies, clientInfo, REFRESH_COOKIE, setAuthCookies } from "@/lib/auth/http";
import { safeNext } from "@/lib/auth/redirect";
import { rotateSession } from "@/lib/auth/session";

/** Relative Location: req.url holds the server's bind address, which is wrong behind a proxy or tunnel. */
const redirectTo = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

/**
 * Navigation-time refresh: the browser only sends the refresh cookie to /api/auth/*,
 * so the proxy bounces here when the access token is missing or expired.
 */
export async function GET(req: NextRequest) {
  let next = safeNext(req.nextUrl.searchParams.get("next"));
  if (next.startsWith("/api/auth/refresh-redirect")) next = "/dashboard";

  const token = req.cookies.get(REFRESH_COOKIE)?.value;
  const result = token ? await rotateSession(token, clientInfo(req)) : { status: "invalid" as const };

  if (result.status !== "ok") {
    return clearAuthCookies(redirectTo(`/login?next=${encodeURIComponent(next)}`));
  }
  return (await setAuthCookies(redirectTo(next), result.access, result.refresh));
}
