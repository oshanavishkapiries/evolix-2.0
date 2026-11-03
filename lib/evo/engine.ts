import { timingSafeEqual } from "node:crypto";
import { getConfig } from "@/lib/config";

/** Constant-time check of the shared secret on calls coming FROM the engine. Fails closed when no secret is configured. */
export async function isEngineCall(req: Request): Promise<boolean> {
  const expected = (await getConfig()).EVO_SECRET_TOKEN;
  const got = req.headers.get("x-evo-secret") ?? "";
  const actualBytes = Buffer.from(got);
  const expectedBytes = Buffer.from(expected);
  if (!expected || actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}
