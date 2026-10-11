import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth/http";
import { checkAdminToken } from "@/lib/auth/admin";
import { verifyAccessToken } from "@/lib/auth/tokens";
import { titleRouteVisible } from "@/lib/viewer/exists";

const PROTECTED = ["/dashboard", "/account", "/admin", "/search", "/movie", "/movies", "/my-list", "/kids", "/tv", "/watch"];
const VIEWER_TITLES = ["/movie", "/tv", "/watch"];
const GUEST_ONLY = ["/login", "/register"];
const matches = (path: string, bases: string[]) =>
  bases.some((b) => path === b || path.startsWith(`${b}/`));

// Signature-only check (no DB). Revoked sessions are caught by GET /api/auth/me.
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  const valid = token ? (await verifyAccessToken(token)) !== null : false;

  if (matches(pathname, PROTECTED) && !valid) {
    // The refresh cookie is only sent to /api/auth/*, so let that route try to renew.
    const url = new URL("/api/auth/refresh-redirect", req.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  if (matches(pathname, ["/admin"])) {
    // Real HTTP redirects for non-admins (the layout guard remains as defense in depth).
    const admin = await checkAdminToken(token);
    if (admin.status === "forbidden") return NextResponse.redirect(new URL("/dashboard", req.url));
    if (admin.status === "unauthenticated") {
      const url = new URL("/api/auth/refresh-redirect", req.url);
      url.searchParams.set("next", pathname + search);
      return NextResponse.redirect(url);
    }
  }
  if (valid && matches(pathname, VIEWER_TITLES) && (await titleRouteVisible(pathname)) === false) {
    // Pages stream (status is fixed at 200), so unknown/unpublished titles are 404'd here.
    return NextResponse.rewrite(new URL("/not-available", req.url));
  }
  if (pathname === "/") {
    // No landing page: signed-in users go straight to the dashboard. With an expired access token
    // the refresh bounce renews the session, or sends a guest to the login page.
    if (valid) return NextResponse.redirect(new URL("/dashboard", req.url));
    const url = new URL("/api/auth/refresh-redirect", req.url);
    url.searchParams.set("next", "/dashboard");
    return NextResponse.redirect(url);
  }
  if (matches(pathname, GUEST_ONLY) && valid) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/admin/:path*",
    "/account/:path*",
    "/search/:path*",
    "/movie/:path*",
    "/movies",
    "/my-list",
    "/kids/:path*",
    "/tv/:path*",
    "/watch/:path*",
    "/login",
    "/register",
  ],
};
