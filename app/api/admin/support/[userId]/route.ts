import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { fail } from "@/lib/auth/http";
import { uuid, threadResponse, sendResponse, statusResponse } from "@/lib/support/http";
import { userExists } from "@/lib/support/store";
type Context = { params: Promise<{ userId: string }> };
async function target(req: NextRequest, ctx: Context) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const { userId } = await ctx.params;
  if (!uuid(userId) || !(await userExists(userId))) return fail(404, "NOT_FOUND", "User not found");
  return { admin, userId };
}
export async function GET(req: NextRequest, ctx: Context) {
  const t = await target(req, ctx);
  return t instanceof Response ? t : threadResponse(req, t.userId, true);
}
export async function POST(req: NextRequest, ctx: Context) {
  const t = await target(req, ctx);
  return t instanceof Response ? t : sendResponse(req, t.userId, t.admin.id, true);
}
export async function PATCH(req: NextRequest, ctx: Context) {
  const t = await target(req, ctx);
  return t instanceof Response ? t : statusResponse(req, t.userId);
}
