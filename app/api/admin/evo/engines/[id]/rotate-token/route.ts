import { json } from "@/lib/auth/http";
import { rotateEngineToken } from "@/lib/evo/registry";
import { registryRoute } from "../../_shared";
export const POST = registryRoute<{ id: string }>(async (_, { id }, actor) => json(200, await rotateEngineToken(id, actor)));
