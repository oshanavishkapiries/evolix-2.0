import { fail, json } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { env } from "@/lib/env";
import { engineHeaders } from "@/lib/evo/engine";

/** Adds a Sinhala subtitle track to a task that already finished caching (backfill, or retry after a failure). */
export const POST = adminRoute<{ taskId: string }>(async (_req, { taskId }) => {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return fail(400, "VALIDATION_ERROR", "Invalid task id");
  try {
    const res = await fetch(`${env.EVO_ENGINE_URL}/api/v1/media/tasks/${taskId}/translate`, { method: "POST", headers: engineHeaders(), cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (res.ok) return json(200, { queued: true });
    const detail = (await res.json().catch(() => null))?.detail;
    return fail(res.status === 409 || res.status === 503 || res.status === 404 ? res.status : 502, "ENGINE_REFUSED", typeof detail === "string" ? detail : `Engine returned ${res.status}`);
  } catch {
    return fail(502, "ENGINE_UNAVAILABLE", "The Evo engine did not answer");
  }
});
