import { z } from "zod";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { getSetting, setSetting } from "@/lib/settings";

export const GET = adminRoute(async () => json(200, { requireEmailVerification: await getSetting("requireEmailVerification") }));

export const PUT = adminRoute(async (req) => {
  const parsed = await parseBody(req, z.object({ requireEmailVerification: z.boolean() }));
  if ("error" in parsed) return parsed.error;
  await setSetting("requireEmailVerification", parsed.data.requireEmailVerification);
  return json(200, parsed.data);
});
