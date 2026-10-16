import { fail } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { engineProxy } from "@/lib/cms/evo-admin";

const UUID = /^[0-9a-f-]{36}$/i;

/** retry: run a failed/uncached task again. cancel: stop a queued/running job before its next stage. */
export const POST = adminRoute<{ taskId: string; action: string }>(async (_req, { taskId, action }) => {
  if (!UUID.test(taskId)) return fail(400, "VALIDATION_ERROR", "Invalid task id");
  if (action !== "retry" && action !== "cancel") return fail(404, "NOT_FOUND", "Unknown action");
  return engineProxy("POST", `/tasks/${taskId}/${action}`);
});
