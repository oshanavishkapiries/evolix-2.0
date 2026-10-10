import { cookies } from "next/headers";
import { ACCESS_COOKIE } from "@/lib/auth/http";
import { verifyAccessToken } from "@/lib/auth/tokens";

/** Signed-in user id from the access cookie (signature check; the proxy already gates viewer pages). Dynamic. */
export async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  return claims?.userId ?? null;
}
