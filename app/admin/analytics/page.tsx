import Link from "next/link";
import { Suspense } from "react";
import { analytics, RANGES, type Range } from "@/lib/cms/analytics";
import { AutoRefresh } from "../_components/auto-refresh";
import { PageHeader } from "../_components/page-header";
import { StackChart } from "../_components/stack-chart";
import { Funnel, Heatmap, HBars, Kpi, TopTitles } from "../_components/analytics-widgets";

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
};

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range } = await searchParams;
  const days = (RANGES.find((r) => String(r) === range) ?? 30) as Range;
  return (
    <>
      <PageHeader
        title="Analytics"
        actions={
          <nav className="an-range" aria-label="Date range">
            {RANGES.map((r) => (
              <Link key={r} href={`?range=${r}`} aria-current={r === days ? "page" : undefined} scroll={false}>
                {r} days
              </Link>
            ))}
          </nav>
        }
      />
      <AutoRefresh seconds={60} />
      <Suspense key={days} fallback={<div className="skeleton mt-4 h-96" aria-busy="true" />}>
        <AnalyticsBody days={days} />
      </Suspense>
    </>
  );
}

async function AnalyticsBody({ days }: { days: Range }) {
  const a = await analytics(days);
  const c = a.current;
  const p = a.previous;
  const labels = a.daily.map((d) => d.day);
  const completion = c.plays ? (c.completed / c.plays) * 100 : 0;
  const prevCompletion = p.plays ? (p.completed / p.plays) * 100 : 0;
  const perViewer = c.viewers ? c.hours / c.viewers : 0;
  const prevPerViewer = p.viewers ? p.hours / p.viewers : 0;
  const devTotal = a.devices.device.reduce((s, r) => s + r.value, 0);
  const pct = (v: number) => `${devTotal ? Math.round((v / devTotal) * 100) : 0}%`;
  const openReports = a.reports.find((r) => r.status === "open")?.n ?? 0;

  return (
    <div className="an">
      <div className="an-kpis">
        <Kpi label="Plays" value={c.plays} prev={p.plays} />
        <Kpi label="Unique viewers" value={c.viewers} prev={p.viewers} />
        <Kpi label="Watch time" value={c.hours} prev={p.hours} digits={1} suffix="h" />
        <Kpi label="Hours per viewer" value={perViewer} prev={prevPerViewer} digits={1} suffix="h" />
        <Kpi label="Finished" value={completion} prev={prevCompletion} suffix="%" hint="Share of plays watched to the end" />
        <Kpi label="New sign-ups" value={c.signups} prev={p.signups} />
      </div>

      <div className="an-grid an-grid-2">
        <StackChart
          title="Daily plays"
          days={labels}
          total={`${c.plays} plays`}
          series={[
            { key: "movies", label: "Movies", color: "#f5a623", values: a.daily.map((d) => d.movies) },
            { key: "episodes", label: "Episodes", color: "#1a8cff", values: a.daily.map((d) => d.episodes) },
          ]}
        />
        <StackChart
          title="Daily active viewers"
          days={labels}
          type="area"
          total={`${c.viewers} unique`}
          series={[{ key: "viewers", label: "Viewers", color: "#8b5cf6", values: a.daily.map((d) => d.viewers) }]}
        />
        <StackChart
          title="Watch hours"
          days={labels}
          type="area"
          format={(n) => n.toFixed(n < 10 ? 1 : 0)}
          total={`${c.hours.toFixed(1)} h`}
          series={[{ key: "hours", label: "Hours", color: "#ec4899", values: a.daily.map((d) => d.seconds / 3600) }]}
        />
        <StackChart
          title="New sign-ups"
          days={labels}
          total={`${c.signups} users`}
          series={[{ key: "signups", label: "Sign-ups", color: "#8bc34a", values: a.daily.map((d) => d.signups) }]}
        />
      </div>

      <TopTitles rows={a.top} />

      <div className="an-grid an-grid-2">
        <Heatmap cells={a.heat} />
        <HBars title="Genres watched" rows={a.genres.map((g) => ({ label: g.genre, value: g.plays }))} unit=" plays" />
      </div>

      <div className="an-grid an-grid-3">
        <Funnel
          steps={[
            { label: "Signed up", value: a.funnel.total },
            { label: "Verified email", value: a.funnel.verified },
            { label: "Approved", value: a.funnel.approved },
            { label: "Ever watched", value: a.funnel.watched },
            { label: `Active, last ${days} days`, value: a.funnel.active },
          ]}
        />
        <HBars title="Devices" rows={a.devices.device.map((d) => ({ ...d, sub: pct(d.value) }))} unit="" note="Distinct users signing in from each device type in this period." />
        <HBars
          title="Platforms"
          rows={[...a.devices.os.slice(0, 4), ...a.devices.browser.slice(0, 4)].map((d, i) => ({ ...d, label: `${i < Math.min(4, a.devices.os.length) ? "OS" : "Browser"} · ${d.label}` }))}
        />
      </div>

      <div className="an-grid an-grid-2">
        <figure className="stat an-card">
          <figcaption>Most active viewers</figcaption>
          {a.viewers.length === 0 ? (
            <p className="an-empty">No viewers in this period.</p>
          ) : (
            <table className="an-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Titles</th>
                  <th>Hours</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {a.viewers.map((v) => (
                  <tr key={v.email}>
                    <td className="an-email">{v.email}</td>
                    <td>{v.plays}</td>
                    <td>{(v.seconds / 3600).toFixed(1)}</td>
                    <td>{ago(v.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </figure>
        <HBars
          title="Catalog health"
          max={100}
          unit="%"
          rows={[
            ...a.coverage.map((r) => ({
              label: `${r.kind === "movie" ? "Movies" : "Shows"} ever watched`,
              value: r.published ? Math.round((r.watched / r.published) * 100) : 0,
              sub: `${r.watched} of ${r.published}`,
            })),
          ]}
          note={`${openReports} open report${openReports === 1 ? "" : "s"}. ${c.bookmarks} titles added to My List this period.`}
        />
      </div>

      <p className="an-note">
        All times are Sri Lanka time (UTC+5:30). A play is a title someone watched or resumed in the period; repeat sessions on the same title count once, on the day they last watched.
        Changes compare with the {days} days before.
      </p>
    </div>
  );
}
