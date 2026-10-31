import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/session";
import { fail } from "@/lib/auth/http";
import { threadResponse, sendResponse, privateJson } from "@/lib/support/http";
import { clearHistory } from "@/lib/support/store";

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  return auth ? threadResponse(req, auth.userId, false) : fail(401, "UNAUTHORIZED", "Not authenticated");
}
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  return auth ? sendResponse(req, auth.userId, auth.userId, false) : fail(401, "UNAUTHORIZED", "Not authenticated");
}
export async function DELETE(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  await clearHistory(auth.userId);
  return privateJson(200);
}
