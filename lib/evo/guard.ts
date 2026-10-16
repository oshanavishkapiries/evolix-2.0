import type { NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth/http";
import { verifyAccessToken } from "@/lib/auth/tokens";

/** Signed-in user id from the access cookie (signature check only, no DB hit), or null. */
export async function viewerId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  return claims?.userId ?? null;
}

const hits = new Map<string, number[]>();

/**
 * Sliding-window limiter (per server instance): true when `key` may proceed. Ingests are expensive
 * (extraction, download, CDN upload), so one account cannot queue them without bound.
 */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}
