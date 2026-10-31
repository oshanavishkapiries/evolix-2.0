import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { fail, parseBody } from "@/lib/auth/http";
import { z } from "zod";
import { uuid, threadResponse, sendResponse, statusResponse, privateJson } from "@/lib/support/http";
import { userExists, deleteConversation } from "@/lib/support/store";
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
export async function DELETE(req: NextRequest, ctx: Context) {
  const t = await target(req, ctx);
  if (t instanceof Response) return t;
  const parsed = await parseBody(req, z.object({ conversationId: z.uuid() }));
  if ("error" in parsed) return parsed.error;
  return await deleteConversation(t.userId, parsed.data.conversationId)
    ? privateJson(200) : fail(404, "NOT_FOUND", "Conversation not found or already deleted");
}
