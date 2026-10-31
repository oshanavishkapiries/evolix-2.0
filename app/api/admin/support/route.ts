import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { fail } from "@/lib/auth/http";
import { privateJson as json } from "@/lib/support/http";
import { findUsers, inbox } from "@/lib/support/store";
import { parseCursor } from "@/lib/support/http";
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const p = req.nextUrl.searchParams;
  const search = (p.get("q") ?? "").trim().slice(0, 254);
  if (p.get("directory") === "1") return json(200, { users: search.length >= 2 ? await findUsers(search) : [] });
  const filter = p.get("filter") ?? "all";
  if (!["all", "needs_reply", "resolved"].includes(filter)) return fail(400, "VALIDATION_ERROR", "Invalid inbox filter");
  try {
    return json(200, await inbox(admin.id, filter, search, parseCursor(p.get("before"))));
  } catch (e) {
    if (e instanceof z.ZodError) return fail(400, "INVALID_CURSOR", "Invalid inbox cursor");
    throw e;
  }
}
