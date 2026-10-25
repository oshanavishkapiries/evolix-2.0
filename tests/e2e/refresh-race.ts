// Concurrent refresh-token race check against the real DB.
//   pnpm tsx --env-file=.env tests/e2e/refresh-race.ts
// Creates a throwaway user, exercises rotateSession, and deletes the user (sessions cascade).
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { createSession, ROTATION_GRACE_MS, rotateSession } from "@/lib/auth/session";

const meta = { userAgent: "race-test", ip: null };
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) process.exitCode = 1;
};
const live = async (userId: string) =>
  (await db.select().from(sessions).where(eq(sessions.userId, userId))).filter((s) => !s.revokedAt).length;

async function main() {
  const [user] = await db
    .insert(users)
    .values({ email: `race-${Date.now()}@example.test`, passwordHash: "x" })
    .returning();
  try {
    // 1. N parallel refreshes with the same token: all succeed, user keeps live sessions.
    const first = await createSession(user.id, meta);
    const results = await Promise.all(Array.from({ length: 5 }, () => rotateSession(first.refresh, meta)));
    check("5 concurrent refreshes all succeed", results.every((r) => r.status === "ok"));
    check("user still has live sessions", (await live(user.id)) > 0);

    // 2. Replay after the grace window is theft: everything revoked.
    const old = await createSession(user.id, meta);
    await rotateSession(old.refresh, meta);
    await db
      .update(sessions)
      .set({ revokedAt: new Date(Date.now() - ROTATION_GRACE_MS - 1000) })
      .where(eq(sessions.id, old.sessionId));
    const replay = await rotateSession(old.refresh, meta);
    check("replay after grace is rejected as reuse", replay.status === "reuse");
    check("replay after grace revokes all sessions", (await live(user.id)) === 0);

    // 3. Signed-out session cannot be refreshed, even immediately.
    const out = await createSession(user.id, meta);
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, out.sessionId));
    check("signed-out session is not resurrected", (await rotateSession(out.refresh, meta)).status !== "ok");
  } finally {
    await db.delete(users).where(eq(users.id, user.id));
  }
}
main().then(() => process.exit());
