import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/session";
import { fail } from "@/lib/auth/http";
import { readResponse } from "@/lib/support/http";
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  return auth ? readResponse(req, auth.userId, auth.userId) : fail(401, "UNAUTHORIZED", "Not authenticated");
}
