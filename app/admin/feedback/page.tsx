import Link from "next/link";
import { Suspense } from "react";
import { feedbackStats, FEEDBACK_RANGES, type FeedbackRange } from "@/lib/cms/feedback-stats";
import { FEEDBACK_TAGS, RATINGS, type FeedbackTag } from "@/lib/feedback";
import { getSetting } from "@/lib/settings";
import { TZ } from "@/lib/tz";
import { AutoRefresh } from "../_components/auto-refresh";
import { HBars, Kpi } from "../_components/analytics-widgets";
import { PageHeader } from "../_components/page-header";
import { StackChart } from "../_components/stack-chart";

type SP = { range?: string; rating?: string; comments?: string; page?: string };

const COLORS = ["#ff5a43", "#ff9f43", "#9a9a9a", "#8bc34a", "#2ecc71"];
const emoji = (r: number) => RATINGS[r - 1]?.emoji ?? "?";
const clock = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ""}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`);
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const days = (FEEDBACK_RANGES.find((r) => String(r) === sp.range) ?? 30) as FeedbackRange;
  const on = await getSetting("playerFeedback");
  return (
    <>
      <PageHeader
        title="Feedback"
        actions={
          <>
          <Link href="/admin/feedback/questions">Player questions →</Link>
          <nav className="an-range" aria-label="Date range">
            {FEEDBACK_RANGES.map((r) => (
              <Link key={r} href={`?range=${r}`} aria-current={r === days ? "page" : undefined} scroll={false}>
                {r} days
              </Link>
            ))}
          </nav>
          </>
        }
      />
      <AutoRefresh seconds={60} />
      {!on && (
        <p className="card mt-4 text-sm">
          The player survey is off, so no new answers come in. Turn it on in <Link href="/admin/settings">Settings</Link>.
        </p>
      )}
      <Suspense key={JSON.stringify(sp)} fallback={<div className="skeleton mt-4 h-96" aria-busy="true" />}>
        <Body days={days} sp={sp} />
      </Suspense>
    </>
  );
}

async function Body({ days, sp }: { days: FeedbackRange; sp: SP }) {
  const rating = Number(sp.rating) >= 1 && Number(sp.rating) <= 5 ? Number(sp.rating) : undefined;
  const comments = sp.comments === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  const s = await feedbackStats(days, { rating, comments, page });
  const c = s.current;
  const p = s.previous;
  const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
  const pages = Math.max(1, Math.ceil(s.total / s.pageSize));
  const href = (over: Partial<SP>) => {
    const qs = new URLSearchParams();
    const next: SP = { range: days === 30 ? undefined : String(days), rating: rating ? String(rating) : undefined, comments: comments ? "1" : undefined, ...over };
    for (const [k, v] of Object.entries(next)) if (v) qs.set(k, v);
    return `/admin/feedback${qs.size ? `?${qs}` : ""}`;
  };
  const tagLabel = (t: string) => FEEDBACK_TAGS[t as FeedbackTag] ?? t;
  const issues = s.tags.filter((t) => ["buffering", "picture", "audio", "subtitles", "start", "other"].includes(t.tag));
  const praise = s.tags.filter((t) => !issues.includes(t));

  if (c.n === 0 && p.n === 0) {
    return (
      <div className="card mt-4 text-center">
        <p className="text-4xl">😐 🙂 😍</p>
        <p className="mt-2 font-semibold">No feedback in this period yet.</p>
        <p className="mt-1 text-sm">The player asks a random sample of viewers after they have watched for a while, when they pause or finish. Answers will show up here.</p>
      </div>
    );
  }

  return (
    <div className="an">
      <div className="an-kpis">
        <Kpi label="Responses" value={c.n} prev={p.n} />
        <Kpi label="Average score" value={c.avg} prev={p.avg} digits={2} suffix="/ 5" />
        <Kpi label="Happy (🙂 😍)" value={pct(c.happy, c.n)} prev={pct(p.happy, p.n)} suffix="%" />
        <Kpi label="Unhappy (😫 🙁)" value={pct(c.unhappy, c.n)} prev={pct(p.unhappy, p.n)} suffix="%" hint="Lower is better" />
        <Kpi label="With a comment" value={c.comments} prev={p.comments} />
      </div>

      <div className="an-grid an-grid-2">
        <figure className="stat an-card">
          <figcaption>Score breakdown</figcaption>
          <ul className="fb-dist">
            {s.distribution
              .slice()
              .reverse()
              .map((d) => (
                <li key={d.rating}>
                  <Link href={href({ rating: rating === d.rating ? undefined : String(d.rating), page: undefined })} aria-current={rating === d.rating ? "true" : undefined} title={`Show ${RATINGS[d.rating - 1].label} answers`}>
                    <span className="fb-emoji">{emoji(d.rating)}</span>
                    <span className="fb-dist-label">{RATINGS[d.rating - 1].label}</span>
                  </Link>
                  <span className="an-hbar-track">
                    <span className="an-hbar-fill" style={{ width: `${pct(d.n, c.n)}%`, background: COLORS[d.rating - 1] }} />
                  </span>
                  <span className="an-hbar-value">
                    {d.n} <small>{Math.round(pct(d.n, c.n))}%</small>
                  </span>
                </li>
              ))}
          </ul>
        </figure>
        <StackChart
          title="Responses per day"
          days={s.days}
          total={`${c.n} answers`}
          series={[1, 2, 3, 4, 5].map((r) => ({ key: String(r), label: `${emoji(r)} ${RATINGS[r - 1].label}`, color: COLORS[r - 1], values: s.perRating(r) }))}
        />
      </div>

      <div className="an-grid an-grid-3">
        <HBars title="What went wrong" rows={issues.map((t) => ({ label: tagLabel(t.tag), value: t.n }))} note="Chips picked after a 😫 🙁 or 😐 rating." />
        <HBars title="What viewers liked" rows={praise.map((t) => ({ label: tagLabel(t.tag), value: t.n }))} />
        <HBars
          title="Score vs buffering"
          max={5}
          rows={s.byStalls.map((b) => ({ label: b.bucket, value: Number(b.avg.toFixed(2)), sub: `${b.n} answers` }))}
          unit=" / 5"
          note="Average score by how often playback stalled before the answer."
        />
      </div>

      <div className="an-grid an-grid-2">
        <HBars title="Score by quality" max={5} unit=" / 5" rows={s.byQuality.map((b) => ({ label: b.quality, value: Number(b.avg.toFixed(2)), sub: `${b.n} answers` }))} />
        <figure className="stat an-card">
          <figcaption>Lowest-rated titles</figcaption>
          <table className="an-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Score</th>
                <th>Answers</th>
              </tr>
            </thead>
            <tbody>
              {s.titles.map((t) => (
                <tr key={t.media_key}>
                  <td>
                    {t.movie_id ? <Link href={`/admin/movies/${t.movie_id}`}>{t.title}</Link> : t.show_id ? <Link href={`/admin/shows/${t.show_id}`}>{t.title}</Link> : t.title}
                  </td>
                  <td>
                    {emoji(Math.round(t.avg))} {t.avg.toFixed(1)}
                  </td>
                  <td>{t.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      </div>

      <section>
        <div className="page-header" style={{ marginBottom: ".5rem" }}>
          <h2>
            Answers{rating ? ` rated ${emoji(rating)} ${RATINGS[rating - 1].label}` : ""} ({s.total})
          </h2>
          <div className="toolbar text-sm">
            {rating && <Link href={href({ rating: undefined, page: undefined })}>Show all scores</Link>}
            <Link href={href({ comments: comments ? undefined : "1", page: undefined })}>{comments ? "Show all answers" : "Only with comments"}</Link>
          </div>
        </div>
        {s.list.length === 0 ? (
          <p className="text-sm">No answers match.</p>
        ) : (
          <ul className="fb-list">
            {s.list.map((f) => (
              <li key={f.id} className="stat">
                <span className="fb-emoji fb-emoji-lg" title={RATINGS[f.rating - 1].label}>{emoji(f.rating)}</span>
                <div className="fb-body">
                  <p className="fb-head">
                    <b>{f.title}</b>
                    <span>{fmt(f.created_at)}</span>
                  </p>
                  {f.comment && <p className="fb-comment">“{f.comment}”</p>}
                  {f.tags.length > 0 && (
                    <p className="fb-tags">
                      {f.tags.map((t) => (
                        <span key={t}>{tagLabel(t)}</span>
                      ))}
                    </p>
                  )}
                  <p className="fb-meta">
                    {f.email ? <Link href={`/admin/users/${f.user_id}`}>{f.email}</Link> : "Deleted user"}
                    <span>at {clock(f.position_seconds)} of {clock(f.duration_seconds)}</span>
                    {f.quality && <span>{f.quality}</span>}
                    {f.stalls != null && <span>{f.stalls === 0 ? "no buffering" : `${f.stalls} stall${f.stalls === 1 ? "" : "s"}`}</span>}
                    {f.trigger && <span>asked on {f.trigger === "playing" ? "long play" : f.trigger}</span>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <p className="toolbar mt-3 justify-between text-sm">
            <span>
              Page {page} of {pages}
            </span>
            <span className="toolbar">
              {page > 1 ? <Link href={href({ page: String(page - 1) })}>Previous</Link> : <span>Previous</span>}
              {page < pages ? <Link href={href({ page: String(page + 1) })}>Next</Link> : <span>Next</span>}
            </span>
          </p>
        )}
      </section>
    </div>
  );
}
