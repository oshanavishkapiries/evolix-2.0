import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth/http";
import { verifyAccessToken } from "@/lib/auth/tokens";

const PROTECTED = ["/dashboard"];
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
  if (matches(pathname, GUEST_ONLY) && valid) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/login", "/register"] };
