import { NextRequest } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { playerFeedback } from "@/db/schema";
import { fail, json, parseBody } from "@/lib/auth/http";
import { authenticate } from "@/lib/auth/session";
import { isUuid } from "@/lib/cms/api";
import { COMMENT_MAX, FEEDBACK_EDIT_MINUTES, FEEDBACK_TAGS, type FeedbackTag } from "@/lib/feedback";

const tag = z.enum(Object.keys(FEEDBACK_TAGS) as [FeedbackTag, ...FeedbackTag[]]);
const body = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  tags: z.array(tag).max(10).optional(),
  comment: z.string().trim().max(COMMENT_MAX).optional(),
});

/** Completes the caller's own answer (follow-up chips and comment), shortly after the emoji tap. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req);
  if (!auth) return fail(401, "UNAUTHORIZED", "Not authenticated");
  const { id } = await ctx.params;
  if (!isUuid(id)) return fail(404, "NOT_FOUND", "Feedback not found");
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { rating, tags, comment } = parsed.data;
  const rows = await db
    .update(playerFeedback)
    .set({ ...(rating ? { rating } : {}), ...(tags ? { tags: [...new Set(tags)] } : {}), ...(comment !== undefined ? { comment } : {}), updatedAt: new Date() })
    .where(
      and(
        eq(playerFeedback.id, id),
        eq(playerFeedback.userId, auth.userId),
        gt(playerFeedback.createdAt, sql`now() - make_interval(mins => ${FEEDBACK_EDIT_MINUTES})`),
      ),
    )
    .returning({ id: playerFeedback.id });
  return rows.length ? json(200, { ok: true }) : fail(404, "NOT_FOUND", "Feedback not found");
}
