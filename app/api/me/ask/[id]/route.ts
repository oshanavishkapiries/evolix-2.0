import { NextRequest } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { feedbackAsks, feedbackQuestions } from "@/db/schema";
import { fail, json, parseBody } from "@/lib/auth/http";
import { authenticate } from "@/lib/auth/session";
import { isUuid } from "@/lib/cms/api";
import { COMMENT_MAX, FEEDBACK_EDIT_MINUTES } from "@/lib/feedback";

const body = z.object({
  /** "ignored": closed or faded away without an answer. Sending a value marks it answered. */
  outcome: z.enum(["ignored"]).optional(),
  value: z.number().int().min(0).max(5).optional(),
  reasons: z.array(z.string().max(60)).max(10).optional(),
  comment: z.string().trim().max(COMMENT_MAX).optional(),
});

/** Records the caller's answer to a question they were just shown (or that they let it go). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const { id } = await ctx.params;
  if (!isUuid(id)) return fail(404, "NOT_FOUND", "Question not found");
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { outcome, value, reasons, comment } = parsed.data;
  const [row] = await db
    .select({ outcome: feedbackAsks.outcome, kind: feedbackQuestions.kind, allowed: feedbackQuestions.reasons })
    .from(feedbackAsks)
    .innerJoin(feedbackQuestions, eq(feedbackQuestions.key, feedbackAsks.questionKey))
    .where(and(eq(feedbackAsks.id, id), eq(feedbackAsks.userId, auth.userId), gt(feedbackAsks.createdAt, sql`now() - make_interval(mins => ${FEEDBACK_EDIT_MINUTES})`)))
    .limit(1);
  if (!row) return fail(404, "NOT_FOUND", "Question not found");
  if (value !== undefined && (row.kind === "thumbs" ? value > 1 : value < 1)) return fail(400, "VALIDATION_ERROR", "Answer out of range");
  if (reasons?.some((r) => !row.allowed.includes(r))) return fail(400, "VALIDATION_ERROR", "Unknown reason");
  // Letting it go never overwrites an answer.
  if (outcome === "ignored" && value === undefined) {
    if (row.outcome === "shown") await db.update(feedbackAsks).set({ outcome: "ignored", updatedAt: new Date() }).where(eq(feedbackAsks.id, id));
    return json(200, { ok: true });
  }
  await db
    .update(feedbackAsks)
    .set({
      ...(value !== undefined ? { value, outcome: "answered" } : {}),
      ...(reasons ? { reasons: [...new Set(reasons)] } : {}),
      ...(comment !== undefined ? { comment } : {}),
      updatedAt: new Date(),
    })
    .where(eq(feedbackAsks.id, id));
  return json(200, { ok: true });
}
