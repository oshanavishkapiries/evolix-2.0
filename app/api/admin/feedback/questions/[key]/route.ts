import { eq } from "drizzle-orm";
import { db } from "@/db";
import { feedbackQuestions } from "@/db/schema";
import { json } from "@/lib/auth/http";
import { adminRoute, notFound, parsePatch } from "@/lib/cms/api";
import { feedbackQuestionPatch } from "@/lib/cms/schemas";

type P = { key: string };

/** Turn a player question on or off, or change its wording, sample, target or priority. Applies to the next ask. */
export const PATCH = adminRoute<P>(async (req, { key }) => {
  const body = await parsePatch(req, feedbackQuestionPatch);
  if ("error" in body) return body.error;
  const [row] = await db.update(feedbackQuestions).set({ ...body.data, updatedAt: new Date() }).where(eq(feedbackQuestions.key, key)).returning();
  return row ? json(200, { question: row }) : notFound("Question");
});
