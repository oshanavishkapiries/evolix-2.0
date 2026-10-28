import { NextRequest } from "next/server";
import { fail } from "@/lib/auth/http";
import { authenticate } from "@/lib/auth/session";
import { captureException } from "@/lib/errors/capture";
import { allow } from "@/lib/evo/guard";
import { canWatch } from "@/lib/viewer/access";

export function subtitleRoute(handler: (req: NextRequest, userId: string) => Promise<Response>, limit = 30) {
  return async (req: NextRequest) => {
    try {
      const session = await authenticate(req);
      if (!session) return fail(401, "UNAUTHORIZED", "Sign in to use subtitles");
      if (!await canWatch(session.userId)) return fail(403, "ACCOUNT_PENDING", "Your account is waiting for admin approval");
      if (!allow(`subtitle:${req.nextUrl.pathname}:${session.userId}`, limit, 60_000)) return fail(429, "RATE_LIMITED", "Too many requests. Try again in a minute.");
      const response = await handler(req, session.userId);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    } catch (e) {
      await captureException(e, { url: req.nextUrl.pathname, method: req.method, headers: req.headers });
      return fail(502, "SUBTITLE_FAILED", "The subtitle service could not complete this request. Try again.");
    }
  };
}
