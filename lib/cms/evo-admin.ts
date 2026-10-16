import { fail, json } from "@/lib/auth/http";
import { env } from "@/lib/env";
import { engineHeaders } from "@/lib/evo/engine";

/** Forwards an admin action to the Evo engine and maps its answer onto our uniform JSON/error responses. */
export async function engineProxy(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) {
  try {
    const res = await fetch(`${env.EVO_ENGINE_URL}/api/v1/media${path}`, {
      method,
      headers: engineHeaders(body === undefined ? {} : { "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(40_000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return json(200, { data });
    const detail = typeof data?.detail === "string" ? data.detail : `Engine returned ${res.status}`;
    return fail([404, 409, 422, 503].includes(res.status) ? res.status : 502, "ENGINE_REFUSED", detail);
  } catch {
    return fail(502, "ENGINE_UNAVAILABLE", "The Evo engine did not answer");
  }
}
