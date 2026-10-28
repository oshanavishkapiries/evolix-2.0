import { NextRequest } from "next/server";
import { fail, json } from "@/lib/auth/http";
import { captureException } from "@/lib/errors/capture";
import { engineFetch, EngineUnavailableError } from "@/lib/evo/client";
import { engineForTask, EngineGoneError, recordSubtitleOwners } from "@/lib/evo/scheduler";
import { viewerId } from "@/lib/evo/guard";
import { promote, promotionFromTask } from "@/lib/evo/promote";
import { classifyFailure, newRef, problemBody } from "@/lib/evo/problems";

export async function GET(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  if (!(await viewerId(req))) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const { taskId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return fail(400, "VALIDATION_ERROR", "Invalid task id");

  try {
    const engine = await engineForTask(taskId);
    const res = await engineFetch(`/status/${taskId}`, { engine });
    if (!res.ok) {
      if (res.status === 404) return json(404, problemBody("NO_SOURCE"));
      return json(503, problemBody(res.status === 502 || res.status === 504 ? "ENGINE_UNAVAILABLE" : "UNKNOWN"));
    }
    const data = (await res.json()) as Record<string, unknown>;
    // Backstop for a lost completion webhook: a finished cache job is registered here too (idempotent).
    await recordSubtitleOwners(engine, data.subtitles);
    const input = promotionFromTask(data);
    if (input) await promote(input, engine.id).catch(() => {});
    if (data.status === "FAILED") {
      // Show a plain sentence; the engine's own text (stack-like, provider names) stays in the admin task view.
      const raw = typeof data.message === "string" ? data.message : "";
      const code = classifyFailure(raw);
      const friendly = problemBody(code);
      return json(200, { ...data, code, title: friendly.title, message: friendly.message, error: friendly.message });
    }
    return json(200, data);
  } catch (e) {
    if (e instanceof EngineUnavailableError) return json(503, problemBody("ENGINE_UNAVAILABLE"));
    if (e instanceof EngineGoneError) return json(503, problemBody("ENGINE_UNAVAILABLE"));
    const ref = newRef();
    await captureException(e, { url: req.nextUrl.pathname, method: req.method, headers: req.headers, level: "warning", tags: { ref } });
    return json(502, problemBody("UNKNOWN", { ref }));
  }
}
