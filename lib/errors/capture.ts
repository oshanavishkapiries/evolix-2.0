import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ACCESS_COOKIE } from "@/lib/auth/http";
import { verifyAccessToken } from "@/lib/auth/tokens";
import { scrubHeaders } from "./scrub";
import { parseStack } from "./stack";
import { recordError, type ErrorInput } from "./store";
import { symbolicate } from "./symbolicate";

type Headerish = Record<string, string | string[] | undefined> | Headers | undefined;

export type CaptureContext = {
  url?: string | null;
  method?: string | null;
  route?: string | null;
  headers?: Headerish;
  level?: ErrorInput["level"];
  tags?: Record<string, unknown>;
};

const header = (h: Headerish, name: string) => {
  if (!h) return undefined;
  const v = h instanceof Headers ? h.get(name) : h[name];
  return Array.isArray(v) ? v[0] : (v ?? undefined);
};

/** Signed-in user from the access cookie (signature check plus one lookup for the email). */
export async function userFromHeaders(h: Headerish): Promise<{ userId: string; email: string | null } | null> {
  const cookie = header(h, "cookie");
  const token = cookie?.match(new RegExp(`(?:^|;\\s*)${ACCESS_COOKIE}=([^;]+)`))?.[1];
  if (!token) return null;
  const claims = await verifyAccessToken(decodeURIComponent(token));
  if (!claims) return null;
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, claims.userId)).limit(1);
  return u ? { userId: claims.userId, email: u.email } : null;
}

/** Full stack including `cause` chains, which hold the real reason for wrapped (e.g. Drizzle) errors. */
function describe(err: unknown) {
  if (!(err instanceof Error)) return { type: "NonError", message: typeof err === "string" ? err : safeJson(err), stack: "" };
  let stack = err.stack ?? `${err.name}: ${err.message}`;
  let cur: unknown = err.cause;
  for (let i = 0; cur && i < 4; i++) {
    stack += `\nCaused by: ${cur instanceof Error ? (cur.stack ?? cur.message) : safeJson(cur)}`;
    cur = cur instanceof Error ? cur.cause : undefined;
  }
  const digest = (err as { digest?: unknown }).digest;
  return { type: err.name || "Error", message: err.message, stack, digest: typeof digest === "string" ? digest : undefined };
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v).slice(0, 1000);
  } catch {
    return String(v);
  }
}

// Errors thrown while recording an error must not loop back into the recorder.
let depth = 0;

/** Records a server-side error. Safe to call anywhere: never throws, never blocks the response on failure. */
export async function captureException(err: unknown, ctx: CaptureContext = {}) {
  if (depth > 0) return;
  depth++;
  try {
    const d = describe(err);
    // Next's control-flow "errors" (redirect, notFound, bailouts) are not bugs.
    if (d.digest && /^(NEXT_|BAILOUT_TO_CLIENT_SIDE_RENDERING|DYNAMIC_SERVER_USAGE)/.test(d.digest)) return;
    const user = await userFromHeaders(ctx.headers).catch(() => null);
    const host = header(ctx.headers, "x-forwarded-host") ?? header(ctx.headers, "host");
    const url = ctx.url && host && ctx.url.startsWith("/") ? `${header(ctx.headers, "x-forwarded-proto") ?? "http"}://${host}${ctx.url}` : ctx.url;
    await recordError({
      source: "server",
      type: d.type,
      message: d.message,
      stack: d.stack,
      frames: symbolicate(parseStack(d.stack)),
      level: ctx.level,
      url,
      method: ctx.method,
      route: ctx.route,
      userId: user?.userId,
      userEmail: user?.email,
      userAgent: header(ctx.headers, "user-agent"),
      context: {
        runtime: process.env.NEXT_RUNTIME ?? "nodejs",
        node: process.version,
        digest: d.digest,
        headers: scrubHeaders(ctx.headers),
        ...ctx.tags,
      },
    });
  } catch (e) {
    console.error("[errors] could not record error:", e instanceof Error ? e.message : e);
  } finally {
    depth--;
  }
}
