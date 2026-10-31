import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/session";
import { fail } from "@/lib/auth/http";
import { deleteOwnMessage } from "@/lib/support/store";
import { parseCursor, privateJson } from "@/lib/support/http";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const { id } = await ctx.params;
  let messageId: number | undefined;
  try { messageId = parseCursor(id); } catch { return fail(400, "VALIDATION_ERROR", "Invalid message"); }
  return messageId && await deleteOwnMessage(auth.userId, messageId)
    ? privateJson(200) : fail(404, "NOT_FOUND", "Message not found");
}
