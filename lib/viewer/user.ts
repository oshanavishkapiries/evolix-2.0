import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth/http";
import { verifyAccessToken } from "@/lib/auth/tokens";

/** Signed-in user id from the access cookie (signature check; the proxy already gates viewer pages). Dynamic. */
export const currentUserId = cache(async (): Promise<string | null> => {
  // Keep token expiry checks and config TTL reads out of prerendering.
  await connection();
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  return claims?.userId ?? null;
});
