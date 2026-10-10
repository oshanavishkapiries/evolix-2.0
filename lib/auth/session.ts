import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { env } from "@/lib/env";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "./http";
import {
  sha256,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "./tokens";

type Meta = { userAgent: string | null; ip: string | null };

/** Creates a session row plus a fresh access/refresh token pair. */
export async function createSession(userId: string, meta: Meta, id = randomUUID()) {
  const refresh = await signRefreshToken(id);
  await db.insert(sessions).values({
    id,
    userId,
    refreshTokenHash: sha256(refresh),
    userAgent: meta.userAgent,
    ip: meta.ip,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000),
  });
  return { sessionId: id, access: await signAccessToken(userId, id), refresh };
}

export function revokeAllSessions(userId: string) {
  return db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export function revokeSession(sessionId: string) {
  return db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/** Resolves the refresh cookie to a session id without touching the DB. */
export async function refreshSessionId(req: NextRequest) {
  const token = req.cookies.get(REFRESH_COOKIE)?.value;
  return token ? (await verifyRefreshToken(token))?.sessionId ?? null : null;
}

export type RotateResult =
  | { status: "ok"; access: string; refresh: string }
  | { status: "invalid" }
  | { status: "reuse" };

export async function rotateSession(token: string, meta: Meta): Promise<RotateResult> {
  const claims = await verifyRefreshToken(token);
  if (!claims) return { status: "invalid" };

  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, claims.sessionId))
    .limit(1);
  if (!row || row.refreshTokenHash !== sha256(token)) return { status: "invalid" };
  if (row.expiresAt <= new Date()) return { status: "invalid" };

  const newId = randomUUID();
  // Atomic claim: only one concurrent request can revoke an active session.
  const claimed = await db
    .update(sessions)
    .set({ revokedAt: new Date(), replacedBy: newId })
    .where(and(eq(sessions.id, row.id), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (claimed.length === 0) {
    await revokeAllSessions(row.userId); // revoked token replayed: assume theft
    return { status: "reuse" };
  }

  const next = await createSession(row.userId, meta, newId);
  return { status: "ok", access: next.access, refresh: next.refresh };
}

/** Validates the access cookie and checks the session is still live in the DB. */
export async function authenticate(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  if (!claims) return null;

  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, claims.sessionId),
        eq(sessions.userId, claims.userId),
        isNull(sessions.revokedAt),
      ),
    )
    .limit(1);
  return row ? claims : null;
}
