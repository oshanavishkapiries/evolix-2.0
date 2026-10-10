import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

type Extra = Record<string, unknown>;

export function json(
  status: number,
  body: { message?: string; code?: string } & Extra = {},
) {
  return NextResponse.json({ ok: status < 400, ...body }, { status });
}

export const fail = (status: number, code: string, message: string, extra: Extra = {}) =>
  json(status, { code, message, ...extra });

/** Parses and validates the JSON body; returns either data or a 400 response. */
export async function parseBody<T extends z.ZodType>(
  req: NextRequest,
  schema: T,
): Promise<{ data: z.infer<T> } | { error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { error: fail(400, "INVALID_BODY", "Request body must be valid JSON") };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      error: fail(400, "VALIDATION_ERROR", "Invalid request", {
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      }),
    };
  }
  return { data: result.data };
}

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const passwordSchema = z.string().min(8).max(128);
export const otpSchema = z.string().regex(/^\d{6}$/, "OTP must be 6 digits");

export function clientInfo(req: NextRequest) {
  return {
    userAgent: req.headers.get("user-agent")?.slice(0, 255) ?? null,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

const base = { httpOnly: true, sameSite: "lax", secure: env.isProd } as const;

export function setAuthCookies(res: NextResponse, access: string, refresh: string) {
  res.cookies.set(ACCESS_COOKIE, access, {
    ...base,
    path: "/",
    maxAge: env.ACCESS_TOKEN_TTL_SECONDS,
  });
  res.cookies.set(REFRESH_COOKIE, refresh, {
    ...base,
    path: "/api/auth",
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS,
  });
  return res;
}

export function clearAuthCookies(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, "", { ...base, path: "/", maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { ...base, path: "/api/auth", maxAge: 0 });
  return res;
}
