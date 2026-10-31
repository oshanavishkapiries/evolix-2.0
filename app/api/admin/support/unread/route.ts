import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { privateJson as json } from "@/lib/support/http";
import { unreadCount } from "@/lib/support/store";
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  return admin instanceof Response ? admin : json(200, { count: await unreadCount(admin.id, true) });
}
