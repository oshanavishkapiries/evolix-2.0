import { z } from "zod";
import { json, parseBody } from "@/lib/auth/http";
import { setDraining } from "@/lib/evo/scheduler";
import { removeEngine, updateEngine, RegistryError } from "@/lib/evo/registry";
import { registryRoute } from "../_shared";

export const PATCH = registryRoute<{ id: string }>(async (req, { id }, actor) => {
  const parsed = await parseBody(req, z.object({ draining: z.boolean().optional(), name: z.string().optional(), url: z.string().optional() }).strict().refine((v) => Object.keys(v).length > 0));
  if ("error" in parsed) return parsed.error;
  let engine;
  if (parsed.data.name !== undefined || parsed.data.url !== undefined) engine = await updateEngine(id, parsed.data, actor);
  if (parsed.data.draining !== undefined && !(await setDraining(id, parsed.data.draining))) throw new RegistryError("Engine not found", 404);
  return json(200, { ...engine, id, draining: parsed.data.draining });
});
export const DELETE = registryRoute<{ id: string }>(async (req, { id }, actor) =>
  json(200, await removeEngine(id, actor, req.nextUrl.searchParams.get("force") === "1")));
