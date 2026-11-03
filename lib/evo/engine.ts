import { timingSafeEqual } from "node:crypto";
import { engineCallbackTokens } from "./registry";

/** Constant-time comparisons against effective per-engine credentials for engine callbacks. */
export async function isEngineCall(req: Request): Promise<boolean> {
  const got = req.headers.get("x-evo-secret") ?? "";
  if (!got) return false;
  const actualBytes = Buffer.from(got);
  let valid = false;
  for (const expected of await engineCallbackTokens()) {
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length === expectedBytes.length) valid = timingSafeEqual(actualBytes, expectedBytes) || valid;
  }
  return valid;
}
