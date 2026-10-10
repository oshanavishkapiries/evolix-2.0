import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { fail, parseBody } from "@/lib/auth/http";
import { TmdbError } from "@/lib/tmdb";

type Ctx<P> = { params: Promise<P> };

/** Wraps a route handler with the admin guard and uniform error mapping. */
export function adminRoute<P extends Record<string, string> = Record<string, never>>(
  handler: (req: NextRequest, params: P) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    const admin = await requireAdmin(req);
    if (admin instanceof NextResponse) return admin;
    try {
      return await handler(req, await ctx.params);
    } catch (e) {
      if (e instanceof TmdbError) return fail(e.status, "TMDB_ERROR", e.message);
      const code = pgCode(e);
      if (code === "23505") return fail(409, "CONFLICT", "A record with these unique values already exists");
      if (code === "23503") return fail(404, "NOT_FOUND", "Referenced record does not exist");
      console.error("admin route error", e instanceof Error ? e.message : e);
      return fail(500, "INTERNAL", "Unexpected server error");
    }
  };
}

/** Postgres error code, looking through Drizzle's error wrapping. */
function pgCode(e: unknown): string | undefined {
  for (let cur = e as { code?: unknown; cause?: unknown } | undefined, i = 0; cur && i < 4; i++) {
    if (typeof cur.code === "string" && /^\d{5}$/.test(cur.code)) return cur.code;
    cur = cur.cause as typeof cur;
  }
}

export const notFound = (what: string) => fail(404, "NOT_FOUND", `${what} not found`);

const uuid = z.uuid();
export const isUuid = (v: string) => uuid.safeParse(v).success;

/** Parses query string params with a zod schema; returns data or a 400 response. */
export function parseQuery<T extends z.ZodType>(
  req: NextRequest,
  schema: T,
): { data: z.infer<T> } | { error: NextResponse } {
  const result = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (result.success) return { data: result.data };
  return {
    error: fail(400, "VALIDATION_ERROR", "Invalid query", {
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    }),
  };
}

/**
 * Validates a PATCH body. Zod applies field defaults even through .partial(),
 * so only keys the client actually sent are kept.
 */
export async function parsePatch<T extends z.ZodType>(req: NextRequest, schema: T) {
  let sent: string[] = [];
  try {
    const raw = await req.clone().json();
    if (raw && typeof raw === "object") sent = Object.keys(raw);
  } catch {}
  const parsed = await parseBody(req, schema);
  if ("error" in parsed) return parsed;
  const data = Object.fromEntries(
    Object.entries(parsed.data as Record<string, unknown>).filter(([k]) => sent.includes(k)),
  ) as Partial<z.infer<T>>;
  if (Object.keys(data).length === 0) {
    return { error: fail(400, "VALIDATION_ERROR", "No fields to update") };
  }
  return { data };
}
