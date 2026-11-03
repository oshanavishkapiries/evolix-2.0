import { createHash, randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { getConfig } from "@/lib/config";

// Read on use, not at import, so `next build` works without secrets.
const accessKey = async () => new TextEncoder().encode((await getConfig()).JWT_ACCESS_SECRET);
const refreshKey = async () => new TextEncoder().encode((await getConfig()).JWT_REFRESH_SECRET);

export const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function signAccessToken(userId: string, sessionId: string) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${(await getConfig()).ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign((await accessKey()));
}

export async function signRefreshToken(sessionId: string) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${(await getConfig()).REFRESH_TOKEN_TTL_SECONDS}s`)
    .sign((await refreshKey()));
}

export async function verifyAccessToken(token: string) {
  const key = await accessKey();
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.sid !== "string") return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string) {
  const key = await refreshKey();
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (typeof payload.sid !== "string") return null;
    return { sessionId: payload.sid };
  } catch {
    return null;
  }
}
