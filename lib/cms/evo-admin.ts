import { NextRequest, NextResponse } from "next/server";
import { fail, json } from "@/lib/auth/http";
import { defaultEngine, engineById, engineFetch, EngineUnavailableError, type EngineRef } from "@/lib/evo/client";

/** The engine an admin call is about: `?engine=<id>`, or the primary one when none is given. A bad id is a 404. */
export async function adminEngine(req: NextRequest): Promise<EngineRef | NextResponse> {
  const id = req.nextUrl.searchParams.get("engine");
  if (!id) return (await defaultEngine());
  return (await engineById(id)) ?? fail(404, "NOT_FOUND", "Unknown engine");
}

/** Forwards an admin action to an Evo engine and maps its answer onto our uniform JSON/error responses. */
export async function engineProxy(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, engine?: EngineRef) {
  try {
    const res = await engineFetch(path, { method, body, engine, timeoutMs: 40_000 });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return json(200, { data });
    const detail = typeof data?.detail === "string" ? data.detail : `Engine returned ${res.status}`;
    return fail([404, 409, 422, 503].includes(res.status) ? res.status : 502, "ENGINE_REFUSED", detail);
  } catch (e) {
    if (e instanceof EngineUnavailableError) return fail(502, "ENGINE_UNAVAILABLE", "The Evo engine did not answer");
    throw e;
  }
}

/** Like engineProxy for the engine named in the request's `engine` query parameter. */
export async function engineProxyFor(req: NextRequest, method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) {
  const engine = (await adminEngine(req));
  return engine instanceof NextResponse ? engine : engineProxy(method, path, body, engine);
}
