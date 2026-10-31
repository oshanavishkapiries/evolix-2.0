import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/session";
import { fail } from "@/lib/auth/http";
import { privateJson as json } from "@/lib/support/http";
import { unreadCount } from "@/lib/support/store";
export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  return auth ? json(200, { count: await unreadCount(auth.userId, false) }) : fail(401, "UNAUTHORIZED", "Not authenticated");
}
