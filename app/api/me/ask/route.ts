import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, json, parseBody } from "@/lib/auth/http";
import { authenticate } from "@/lib/auth/session";
import { MOMENTS, type Moment } from "@/lib/feedback";
import { pickQuestion } from "@/lib/viewer/feedback";

const body = z.object({
  moment: z.enum(Object.keys(MOMENTS) as [Moment, ...Moment[]]),
  mediaKey: z.string().min(1).max(200),
  title: z.string().max(300).default(""),
  context: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).refine((c) => Object.keys(c).length <= 20).default({}),
});

/** The player reached a moment: answers with the question to ask now, or `ask: null` (most of the time). */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  const picked = await pickQuestion(auth.userId, d.moment, { key: d.mediaKey, title: d.title }, d.context);
  return json(200, { ask: picked.ask });
}
