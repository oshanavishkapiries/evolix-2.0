import { NextRequest } from "next/server";
import { fail, json } from "@/lib/auth/http";
import { engineFetch, EngineUnavailableError } from "@/lib/evo/client";
import { engineForTask, EngineGoneError, recordSubtitleOwners } from "@/lib/evo/scheduler";
import { viewerId } from "@/lib/evo/guard";
import { promote, promotionFromTask } from "@/lib/evo/promote";

export async function GET(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  if (!(await viewerId(req))) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const { taskId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return fail(400, "VALIDATION_ERROR", "Invalid task id");

  try {
    const engine = await engineForTask(taskId);
    const res = await engineFetch(`/status/${taskId}`, { engine });
    if (!res.ok) return json(res.status, { error: `Evo engine returned ${res.status}` });
    const data = (await res.json()) as Record<string, unknown>;
    // Backstop for a lost completion webhook: a finished cache job is registered here too (idempotent).
    await recordSubtitleOwners(engine, data.subtitles);
    const input = promotionFromTask(data);
    if (input) await promote(input, engine.id).catch(() => {});
    return json(200, data);
  } catch (e) {
    if (e instanceof EngineUnavailableError) return json(503, { error: "The engine running this task is unavailable", code: "ENGINE_UNAVAILABLE" });
    if (e instanceof EngineGoneError) return json(503, { error: e.message, code: "ENGINE_UNAVAILABLE" });
    return json(502, { error: e instanceof Error ? e.message : "Failed to connect to the engine" });
  }
}
