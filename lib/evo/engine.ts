import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** Headers every call to the Evo engine carries. */
export function engineHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return env.EVO_SECRET_TOKEN ? { ...extra, "X-Evo-Secret": env.EVO_SECRET_TOKEN } : extra;
}

/** Constant-time check of the shared secret on calls coming FROM the engine. Fails closed when no secret is configured. */
export function isEngineCall(req: Request): boolean {
  const expected = env.EVO_SECRET_TOKEN;
  const got = req.headers.get("x-evo-secret") ?? "";
  if (!expected || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
