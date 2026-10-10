import { and, eq, isNull } from "drizzle-orm";
import type { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { env } from "@/lib/env";
import { ACCESS_COOKIE, fail } from "./http";
import { verifyAccessToken } from "./tokens";

export type AdminCheck =
  | { status: "ok"; user: { id: string; email: string } }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export const isAdminEmail = (email: string) => env.adminEmails.includes(email.toLowerCase());

/** Verifies the access token, the live session, and the admin allow-list. */
export async function checkAdminToken(token: string | undefined): Promise<AdminCheck> {
  const claims = token ? await verifyAccessToken(token) : null;
  if (!claims) return { status: "unauthenticated" };

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, claims.sessionId),
        eq(sessions.userId, claims.userId),
        isNull(sessions.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return { status: "unauthenticated" };
  if (!row.emailVerifiedAt || !isAdminEmail(row.email)) return { status: "forbidden" };
  return { status: "ok", user: { id: row.id, email: row.email } };
}

/** For route handlers: returns the admin user, or a 401/403 response. */
export async function requireAdmin(
  req: NextRequest,
): Promise<{ id: string; email: string } | NextResponse> {
  const result = await checkAdminToken(req.cookies.get(ACCESS_COOKIE)?.value);
  if (result.status === "ok") return result.user;
  return result.status === "unauthenticated"
    ? fail(401, "UNAUTHORIZED", "Not authenticated")
    : fail(403, "FORBIDDEN", "Admin access required");
}
