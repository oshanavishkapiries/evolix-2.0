import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { fail } from "@/lib/auth/http";
import { RegistryError } from "@/lib/evo/registry";

/** Same live-session admin guard as the other admin routes; errors never log token-bearing requests/SQL. */
export function registryRoute<P extends Record<string, string> = Record<string, never>>(
  handler: (req: NextRequest, params: P, actor: string) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    const admin = await requireAdmin(req);
    if (admin instanceof NextResponse) return admin;
    try {
      const response = await handler(req, await ctx.params, admin.email);
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch (e) {
      return fail(e instanceof RegistryError ? e.status : 500, "ENGINE_REGISTRY_ERROR", e instanceof RegistryError ? e.message : "Engine registry unavailable");
    }
  };
}
