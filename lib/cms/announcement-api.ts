import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { fail } from "@/lib/auth/http";
import { AnnouncementError } from "./announcements";
import type { NextRequest } from "next/server";

/** Runs an announcement write, turning validation failures into 4xx responses the admin form can show. */
export async function announcementWrite(run: () => Promise<NextResponse>) {
  try {
    return await run();
  } catch (e) {
    if (e instanceof AnnouncementError) return fail(e.status, e.status === 409 ? "CONFLICT" : "VALIDATION_ERROR", e.message, { issues: [{ path: e.path, message: e.message }] });
    throw e;
  }
}

/** Admin id for `createdBy`; the route is already behind adminRoute, so this only reads it. */
export async function adminId(req: NextRequest) {
  const admin = await requireAdmin(req);
  return admin instanceof NextResponse ? null : admin.id;
}
