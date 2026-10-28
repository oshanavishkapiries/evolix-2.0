import Link from "next/link";
import type { DayPoint, adminOverview } from "@/lib/cms/stats";
import { compareWindows, engineTone, errorTone, reportTone, type Tone } from "@/lib/cms/overview-view";
import { StackChart } from "./stack-chart";
import { TitleRows } from "./title-rows";

const num = (n: number, digits = 0) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** One area of the site at a glance: a big number, a line of detail, coloured by whether it needs someone. */
function StatusCard({ title, href, tone, value, detail, cta }: { title: string; href: string; tone: Tone; value: React.ReactNode; detail: React.ReactNode; cta: string }) {
  return (
    <Link href={href} className="ov-status" data-tone={tone}>
      <span className="ov-status-head">
        <span>{title}</span>
        <i aria-hidden="true" />
      </span>
      <strong>{value}</strong>
      <span className="ov-status-detail">{detail}</span>
      <span className="ov-status-cta">{cta} →</span>
    </Link>
  );
}

/** A 14-day line without axes: the shape matters here, the exact numbers are in the tile. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 0);
  const w = 120;
  const h = 32;
  const pts = values.map((v, i) => `${((i / Math.max(values.length - 1, 1)) * w).toFixed(1)},${(h - 2 - (max ? (v / max) * (h - 4) : 0)).toFixed(1)}`);
  return (
    <svg className="ov-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} fill={color} opacity=".14" />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Trend({ label, values, color, digits = 0, unit = "", money = false, avg = false, hint }: { label: string; values: number[]; color: string; digits?: number; unit?: string; money?: boolean; avg?: boolean; hint?: string }) {
  const { now, change } = compareWindows(values, 7, avg);
  const tone = change === null ? "" : change > 0 ? "an-up" : change < 0 ? "an-down" : "";
  return (
    <div className="ov-trend">
      <span className="ov-trend-label" title={hint}>{label}{hint && <sup aria-hidden="true">*</sup>}</span>
      <strong>
        {money && "$"}{num(now, digits)}{unit && <small> {unit}</small>}
      </strong>
      <span className={`an-delta ${tone}`}>
        {change === null ? (now ? "new this week" : "no data yet") : `${change > 0 ? "▲" : change < 0 ? "▼" : "•"} ${num(Math.abs(change))}% vs week before`}
      </span>
      <Sparkline values={values} color={color} />
    </div>
  );
}

type OverviewData = {
  o: Awaited<ReturnType<typeof adminOverview>>;
  days: DayPoint[];
  errs: { open: number; new24: number; events24: number } | null;
  engines: { healthy: boolean; activeJobs: number; queueDepth: number }[];
  /** The estimate behind "data served" and "CDN cost". */
  rates: { gbPerHour: number; costPerGb: number };
};

/** The overview from its data (no fetching), so it can be looked at with made-up numbers. */
export function OverviewView({ o, days, errs, engines, rates }: OverviewData) {
  const labels = days.map((d) => d.day);
  const col = <K extends keyof (typeof days)[number]>(k: K) => days.map((d) => d[k] as number);
  const up = engines.filter((e) => e.healthy).length;
  const busy = engines.reduce((n, e) => n + e.activeJobs + e.queueDepth, 0);
  const drafts = o.movies.total - o.movies.published + (o.shows.total - o.shows.published);

  return (
    <div className="ov">
      <section aria-labelledby="ov-health">
        <h2 id="ov-health" className="ov-h">Right now</h2>
        <div className="ov-status-grid">
          <StatusCard
            title="Evo engines"
            href="/admin/evo"
            tone={engines.length ? engineTone(up, engines.length) : "warn"}
            value={<>{up}<small>/{engines.length} up</small></>}
            detail={busy ? `${busy} job(s) running or waiting` : "idle"}
            cta="Pipeline"
          />
          <StatusCard
            title="Errors"
            href="/admin/errors"
            tone={errorTone(errs)}
            value={errs ? <>{errs.open}<small> open</small></> : "—"}
            detail={errs ? `${errs.new24} new · ${errs.events24} events since yesterday` : "could not be read"}
            cta="Errors"
          />
          <StatusCard
            title="Viewer reports"
            href="/admin/reports"
            tone={reportTone(o.reports)}
            value={<>{o.reports.open}<small> open</small></>}
            detail={o.reports.new24 ? `${o.reports.new24} new in 24 hours` : "nothing new in 24 hours"}
            cta="Reports"
          />
          <StatusCard
            title="Catalog"
            href="/admin/movies"
            tone="ok"
            value={<>{o.movies.total + o.shows.total}<small> titles</small></>}
            detail={`${o.movies.total} movies · ${o.shows.total} shows${drafts ? ` · ${drafts} draft` : ""}`}
            cta="Movies"
          />
        </div>
      </section>

      <section aria-labelledby="ov-week">
        <div className="ov-head">
          <h2 id="ov-week" className="ov-h">Last 7 days</h2>
          <Link href="/admin/analytics" className="ov-more">Full analytics →</Link>
        </div>
        <div className="ov-trend-grid">
          <Trend label="Plays" values={col("plays")} color="#8b5cf6" />
          <Trend label="Viewers a day" values={col("viewers")} color="#1a8cff" avg digits={1} hint="Average of people who watched something each day" />
          <Trend label="New sign-ups" values={col("signups")} color="#8bc34a" />
          <Trend label="Watch time" values={col("hours")} color="#ec4899" digits={1} unit="h" />
          <Trend label="Data served" values={col("gb")} color="#f5a623" digits={1} unit="GB" hint={`Estimate: ${rates.gbPerHour} GB per watched hour`} />
          <Trend label="CDN cost" values={col("cost")} color="#ff5a43" digits={2} money hint={`Estimate: $${rates.costPerGb} per GB`} />
        </div>
      </section>

      <section aria-labelledby="ov-days">
        <h2 id="ov-days" className="ov-h">Last 14 days</h2>
        <div className="ov-chart-grid">
          <StackChart title="Plays" type="area" days={labels} series={[{ key: "plays", label: "", color: "#8b5cf6", values: col("plays") }]} total={`${num(col("plays").reduce((a, b) => a + b, 0))} plays`} />
          <StackChart title="New sign-ups" days={labels} series={[{ key: "signups", label: "", color: "#8bc34a", values: col("signups") }]} total={`${num(col("signups").reduce((a, b) => a + b, 0))} users`} />
        </div>
        <p className="ov-foot">* Data and cost are estimates from watched time; actual CDN traffic is not recorded. OpenRouter spend is under <Link href="/admin/openrouter">OpenRouter</Link>.</p>
      </section>

      <div className="ov-recent">
        <section aria-labelledby="ov-movies">
          <div className="ov-head">
            <h2 id="ov-movies" className="ov-h">Recent movies</h2>
            <Link href="/admin/movies" className="ov-more">All {o.movies.total} →</Link>
          </div>
          {o.recentMovies.length ? <TitleRows kind="movies" rows={o.recentMovies} /> : <p className="evo-empty">No movies yet.</p>}
        </section>
        <section aria-labelledby="ov-shows">
          <div className="ov-head">
            <h2 id="ov-shows" className="ov-h">Recent shows</h2>
            <Link href="/admin/shows" className="ov-more">All {o.shows.total} →</Link>
          </div>
          {o.recentShows.length ? <TitleRows kind="shows" rows={o.recentShows} /> : <p className="evo-empty">No shows yet.</p>}
        </section>
      </div>
    </div>
  );
}
