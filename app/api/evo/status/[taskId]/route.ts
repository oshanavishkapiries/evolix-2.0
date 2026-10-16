import { NextRequest } from "next/server";
import { fail, json } from "@/lib/auth/http";
import { env } from "@/lib/env";
import { engineHeaders } from "@/lib/evo/engine";
import { viewerId } from "@/lib/evo/guard";
import { promote, promotionFromTask } from "@/lib/evo/promote";

export async function GET(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  if (!(await viewerId(req))) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const { taskId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return fail(400, "VALIDATION_ERROR", "Invalid task id");

  try {
    const res = await fetch(`${env.EVO_ENGINE_URL}/api/v1/media/status/${taskId}`, { headers: engineHeaders(), cache: "no-store" });
    if (!res.ok) return json(res.status, { error: `Evo engine returned ${res.status}` });
    const data = (await res.json()) as Record<string, unknown>;
    // Backstop for a lost completion webhook: a finished cache job is registered here too (idempotent).
    const input = promotionFromTask(data);
    if (input) await promote(input).catch(() => {});
    return json(200, data);
  } catch (e) {
    return json(502, { error: e instanceof Error ? e.message : "Failed to connect to the engine" });
  }
}
