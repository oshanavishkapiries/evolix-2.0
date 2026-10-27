import { z } from "zod";
import { json, parseBody } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { getSetting, setSetting } from "@/lib/settings";

export const GET = adminRoute(async () =>
  json(200, { requireApproval: await getSetting("requireApproval"), playerFeedback: await getSetting("playerFeedback") }),
);

/** Updates whichever switches are sent. */
export const PUT = adminRoute(async (req) => {
  const parsed = await parseBody(req, z.object({ requireApproval: z.boolean().optional(), playerFeedback: z.boolean().optional() }));
  if ("error" in parsed) return parsed.error;
  for (const key of ["requireApproval", "playerFeedback"] as const) {
    const value = parsed.data[key];
    if (value !== undefined) await setSetting(key, value);
  }
  return json(200, parsed.data);
});
