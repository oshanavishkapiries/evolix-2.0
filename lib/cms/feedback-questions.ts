import "server-only";
import { asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { feedbackQuestions } from "@/db/schema";

const q = async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)).rows as T[];

export type QuestionRow = typeof feedbackQuestions.$inferSelect;
export type QuestionStats = {
  shown: number;
  answered: number;
  ignored: number;
  /** Thumbs: share of 👍 (0-100). Faces: average 1-5. Null without answers. */
  score: number | null;
  reasons: { reason: string; n: number }[];
};
export type RecentAnswer = {
  id: string;
  question_key: string;
  title: string;
  value: number | null;
  reasons: string[];
  comment: string;
  context: Record<string, string | number | boolean | null>;
  created_at: string;
  user_id: string;
  email: string | null;
};

/** Every question with how it is doing, plus the latest answers that carry reasons or a comment. */
export async function questionReport() {
  const [questions, counts, scores, reasons, recent, [experience]] = await Promise.all([
    db.select().from(feedbackQuestions).orderBy(desc(feedbackQuestions.active), desc(feedbackQuestions.priority), asc(feedbackQuestions.key)),
    q<{ key: string; outcome: string; n: number }>(sql`select question_key as key, outcome, count(*)::int as n from feedback_asks group by 1, 2`),
    q<{ key: string; up: number | null; avg: number | null }>(sql`
      select a.question_key as key, (avg(case when a.value = 1 then 100 else 0 end) filter (where q.kind = 'thumbs'))::float as up,
             (avg(a.value) filter (where q.kind = 'faces'))::float as avg
      from feedback_asks a join feedback_questions q on q.key = a.question_key
      where a.outcome = 'answered' group by 1`),
    q<{ key: string; reason: string; n: number }>(sql`select question_key as key, r as reason, count(*)::int as n from feedback_asks, unnest(reasons) as r group by 1, 2 order by 3 desc`),
    q<RecentAnswer>(sql`
      select a.id, a.question_key, a.title, a.value, a.reasons, a.comment, a.context, a.created_at, a.user_id, u.email
      from feedback_asks a left join users u on u.id = a.user_id
      where a.outcome = 'answered' and (a.comment <> '' or cardinality(a.reasons) > 0)
      order by a.created_at desc limit 40`),
    // The experience survey's answers live in player_feedback (its own page shows them in full).
    q<{ n: number; avg: number | null }>(sql`select count(*)::int as n, avg(rating)::float as avg from player_feedback`),
  ]);
  const stats = new Map<string, QuestionStats>();
  for (const question of questions) {
    const n = (outcome: string) => counts.find((c) => c.key === question.key && c.outcome === outcome)?.n ?? 0;
    const s = scores.find((x) => x.key === question.key);
    stats.set(question.key, {
      shown: n("shown") + n("answered") + n("ignored"),
      answered: question.key === "experience" ? experience.n : n("answered"),
      ignored: n("ignored"),
      score: question.key === "experience" ? experience.avg : question.kind === "thumbs" ? (s?.up ?? null) : (s?.avg ?? null),
      reasons: reasons.filter((r) => r.key === question.key).slice(0, 6),
    });
  }
  return { questions, stats, recent };
}
