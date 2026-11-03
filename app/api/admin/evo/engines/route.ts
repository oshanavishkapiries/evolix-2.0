import { z } from "zod";
import { json, parseBody } from "@/lib/auth/http";
import { enginesOverview } from "@/lib/evo/overview";
import { addEngine, listEngines } from "@/lib/evo/registry";
import { registryRoute } from "./_shared";

/** Keep the existing polling contract and add safe registry fields. No credential envelopes or tokens. */
export const GET = registryRoute(async () => {
  const registry = await listEngines();
  const overview = await enginesOverview();
  return json(200, { managed: registry.managed, engines: registry.engines.map((e) => ({ ...overview.find((r) => r.id === e.id), ...e })) });
});
export const POST = registryRoute(async (req, _, actor) => {
  const parsed = await parseBody(req, z.object({ name: z.string(), url: z.string(), token: z.string().optional() }).strict());
  if ("error" in parsed) return parsed.error;
  return json(201, await addEngine(parsed.data, actor));
});
