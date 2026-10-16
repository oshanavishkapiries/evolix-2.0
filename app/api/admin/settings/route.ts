import { z } from "zod";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { getSetting, setSetting } from "@/lib/settings";

export const GET = adminRoute(async () => json(200, { requireApproval: await getSetting("requireApproval") }));

export const PUT = adminRoute(async (req) => {
  const parsed = await parseBody(req, z.object({ requireApproval: z.boolean() }));
  if ("error" in parsed) return parsed.error;
  await setSetting("requireApproval", parsed.data.requireApproval);
  return json(200, parsed.data);
});
