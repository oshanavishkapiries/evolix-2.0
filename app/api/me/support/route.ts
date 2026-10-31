import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/session";
import { fail } from "@/lib/auth/http";
import { threadResponse, sendResponse } from "@/lib/support/http";

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  return auth ? threadResponse(req, auth.userId, false) : fail(401, "UNAUTHORIZED", "Not authenticated");
}
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  return auth ? sendResponse(req, auth.userId, auth.userId, false) : fail(401, "UNAUTHORIZED", "Not authenticated");
}
