import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { fail } from "@/lib/auth/http";
import { uuid, readResponse } from "@/lib/support/http";
export async function POST(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const { userId } = await ctx.params;
  return uuid(userId) ? readResponse(req, userId, admin.id) : fail(404, "NOT_FOUND", "User not found");
}
