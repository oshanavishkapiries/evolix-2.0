import { createHash, randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { env } from "@/lib/env";

const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function signAccessToken(userId: string, sessionId: string) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessKey);
}

export function signRefreshToken(sessionId: string) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${env.REFRESH_TOKEN_TTL_SECONDS}s`)
    .sign(refreshKey);
}

export async function verifyAccessToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, accessKey, { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.sid !== "string") return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, refreshKey, { algorithms: ["HS256"] });
    if (typeof payload.sid !== "string") return null;
    return { sessionId: payload.sid };
  } catch {
    return null;
  }
}
