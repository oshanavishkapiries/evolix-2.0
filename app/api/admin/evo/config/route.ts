import { z } from "zod";
import { parseBody } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

/** Runtime settings of one engine (`?engine=`, default: the primary): concurrency, queue limit, disk floor, browser pool... */
export const GET = adminRoute(async (req) => engineProxyFor(req, "GET", "/config"));

export const PUT = adminRoute(async (req) => {
  const parsed = await parseBody(req, z.record(z.string(), z.number()));
  if ("error" in parsed) return parsed.error;
  return engineProxyFor(req, "PUT", "/config", parsed.data);
});
