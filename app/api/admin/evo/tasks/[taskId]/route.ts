import { fail, json } from "@/lib/auth/http";
import { adminRoute, notFound } from "@/lib/cms/api";
import { engineTaskDetail } from "@/lib/cms/evo";

/** Live data for the admin flow view: the engine task plus its step events. */
export const GET = adminRoute<{ taskId: string }>(async (_req, { taskId }) => {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return fail(400, "VALIDATION_ERROR", "Invalid task id");
  const detail = await engineTaskDetail(taskId);
  return detail ? json(200, detail) : notFound("Task");
});
