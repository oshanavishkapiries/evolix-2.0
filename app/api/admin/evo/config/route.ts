import { z } from "zod";
import { parseBody } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { engineProxy } from "@/lib/cms/evo-admin";

/** Runtime engine settings (concurrency, queue limit, disk floor, translation budget). */
export const GET = adminRoute(async () => engineProxy("GET", "/config"));

export const PUT = adminRoute(async (req) => {
  const parsed = await parseBody(req, z.record(z.string(), z.number()));
  if ("error" in parsed) return parsed.error;
  return engineProxy("PUT", "/config", parsed.data);
});
