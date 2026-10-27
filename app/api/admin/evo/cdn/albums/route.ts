import { z } from "zod";
import { parseBody } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

export const GET = adminRoute(async (req) => engineProxyFor(req, "GET", "/cdn/albums"));

/** Bundle files into a new album. */
export const POST = adminRoute(async (req) => {
  const parsed = await parseBody(req, z.object({ title: z.string().trim().min(1).max(200), ids: z.array(z.string().max(40)).min(1).max(1000) }));
  if ("error" in parsed) return parsed.error;
  return engineProxyFor(req, "POST", "/cdn/albums", parsed.data);
});
