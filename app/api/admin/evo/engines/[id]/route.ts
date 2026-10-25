import { z } from "zod";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute, notFound } from "@/lib/cms/api";
import { setDraining } from "@/lib/evo/scheduler";

const body = z.object({ draining: z.boolean() });

/** Marks an engine as draining (no new jobs; active ones finish) or puts it back in rotation. */
export const PATCH = adminRoute<{ id: string }>(async (req, { id }) => {
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  return (await setDraining(id, parsed.data.draining)) ? json(200, { id, draining: parsed.data.draining }) : notFound("Engine");
});
