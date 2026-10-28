import { eq } from "drizzle-orm";
import { db } from "@/db";
import { evoTasks } from "@/db/schema";
import { fail, json } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { engineProxy } from "@/lib/cms/evo-admin";
import { parseIngestKey, startIngest } from "@/lib/evo/ingest";
import { engineForTask } from "@/lib/evo/scheduler";
import { TmdbError } from "@/lib/tmdb";

const UUID = /^[0-9a-f-]{36}$/i;

/** Runs on the engine that owns the task (move: starts a new job on another one). retry: run a failed/uncached task again. cancel: stop a queued/running job before its next stage. */
export const POST = adminRoute<{ taskId: string; action: string }>(async (_req, { taskId, action }) => {
  if (!UUID.test(taskId)) return fail(400, "VALIDATION_ERROR", "Invalid task id");
  if (action === "move") return moveTask(taskId);
  if (action !== "retry" && action !== "cancel") return fail(404, "NOT_FOUND", "Unknown action");
  return engineProxy("POST", `/tasks/${taskId}/${action}`, undefined, await engineForTask(taskId));
});

/**
 * Retry on another engine: a new job on a different healthy engine (fresh extraction there). The old task stays
 * with its engine, so nothing is silently moved; playback of the old task may be interrupted.
 */
async function moveTask(taskId: string) {
  const [row] = await db.select().from(evoTasks).where(eq(evoTasks.taskId, taskId)).limit(1);
  const input = parseIngestKey(row?.claimKey);
  if (!row || !input) return fail(409, "CONFLICT", "Only video tasks started through the app can be moved to another engine");
  try {
    const out = await startIngest(input, { avoidEngine: row.engineId });
    if (out.kind === "not_found") return fail(404, "NOT_FOUND", out.message);
    if (out.kind === "error") return fail(out.status === 503 ? 503 : 502, "ENGINE_REFUSED", String(out.body.detail ?? out.body.error ?? "Could not start the job"));
    return json(200, { taskId: out.data.task_id, engineId: out.engineId });
  } catch (e) {
    if (e instanceof TmdbError) return fail(404, "NOT_FOUND", "Title not found");
    throw e;
  }
}
