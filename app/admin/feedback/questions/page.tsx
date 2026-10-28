import Link from "next/link";
import { Suspense } from "react";
import { questionReport } from "@/lib/cms/feedback-questions";
import { BUDGET, RATINGS } from "@/lib/feedback";
import { getSetting } from "@/lib/settings";
import { TZ } from "@/lib/tz";
import { FeedbackQuestions } from "../../_components/feedback-questions";
import { PageHeader } from "../../_components/page-header";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });

export default async function QuestionsPage() {
  const on = await getSetting("playerFeedback");
  return (
    <>
      <PageHeader title="Player questions" actions={<Link href="/admin/feedback">← Experience survey results</Link>} />
      <p className="mt-2 text-sm">
        Small questions the player asks after a viewer used a feature. All questions share one budget per viewer: one per
        viewing, at least {BUDGET.gapDays} days apart, at most {BUDGET.weeklyMax} a week, and none for {BUDGET.backoffDays} days
        after {BUDGET.ignoreStreak} were ignored in a row. Viewers can also say “don’t ask me”.
      </p>
      {!on && (
        <p className="card mt-3 text-sm">
          Player feedback is off, so no question is asked. Turn it on in <Link href="/admin/settings">Settings</Link>.
        </p>
      )}
      <Suspense fallback={<div className="skeleton mt-4 h-96" aria-busy="true" />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  const { questions, stats, recent } = await questionReport();
  const prompt = (key: string) => questions.find((q) => q.key === key);
  const answerText = (key: string, value: number | null) => {
    if (value === null) return "—";
    return prompt(key)?.kind === "thumbs" ? (value ? "👍" : "👎") : (RATINGS[value - 1]?.emoji ?? String(value));
  };
  return (
    <>
      <FeedbackQuestions questions={questions} stats={Object.fromEntries(stats)} />
      <h2 className="mt-6">Latest answers with reasons or a comment</h2>
      {!recent.length ? (
        <p className="mt-2 text-sm">None yet.</p>
      ) : (
        <ul className="fb-list mt-2">
          {recent.map((a) => (
            <li key={a.id} className="stat">
              <span className="fb-emoji fb-emoji-lg">{answerText(a.question_key, a.value)}</span>
              <div className="fb-body">
                <p className="fb-head">
                  <b>{prompt(a.question_key)?.prompt ?? a.question_key}</b>
                  <span>{fmt(a.created_at)}</span>
                </p>
                {a.comment && <p className="fb-comment">“{a.comment}”</p>}
                {a.reasons.length > 0 && (
                  <p className="fb-tags">
                    {a.reasons.map((r) => (
                      <span key={r}>{r}</span>
                    ))}
                  </p>
                )}
                <p className="fb-meta">
                  {a.email ? <Link href={`/admin/users/${a.user_id}`}>{a.email}</Link> : "Deleted user"}
                  {a.title && <span>{a.title}</span>}
                  {Object.entries(a.context).map(([k, v]) => (
                    <span key={k}>
                      {k}: {String(v)}
                    </span>
                  ))}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
