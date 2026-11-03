import { z } from "zod";
import { json, parseBody } from "@/lib/auth/http";
import { testEngineConnection } from "@/lib/evo/registry";
import { registryRoute } from "../_shared";
export const POST = registryRoute(async (req) => {
  const parsed = await parseBody(req, z.object({ url: z.string(), token: z.string() }).strict());
  if ("error" in parsed) return parsed.error;
  return json(200, await testEngineConnection(parsed.data));
});
