import Link from "next/link";
import { adminAnalytics, adminOverview, COST_PER_GB, GB_PER_HOUR } from "@/lib/cms/stats";
import { openRouterStats } from "@/lib/openrouter";
import { StackChart } from "./stack-chart";
import { TitleRows } from "./title-rows";

function Stat({ label, href, total, published }: { label: string; href: string; total: number; published: number }) {
  return (
    <div className="stat">
      <h2 className="text-base">
        <Link href={href}>{label}</Link>
      </h2>
      <strong>{total}</strong>
      <small>
        {published} published, {total - published} draft
      </small>
    </div>
  );
}

/** Dashboard: counts plus the newest titles. Server-rendered. */
export async function AdminOverview() {
  const [o, days, or] = await Promise.all([adminOverview(), adminAnalytics(), openRouterStats()]);
  const labels = days.map((d) => d.day);
  const one = (title: string, f: (d: (typeof days)[number]) => number, color: string, o2: { type?: "bar" | "area"; digits?: number; unit?: string; money?: boolean } = {}) => {
    const values = days.map(f);
    const sum = values.reduce((a, b) => a + b, 0);
    const d = o2.digits ?? 0;
    const num = (n: number) => `${o2.money ? "$" : ""}${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
    return <StackChart title={title} days={labels} type={o2.type} series={[{ key: title, label: "", color, values }]} format={(n) => num(n)} total={`${num(sum)}${o2.unit ? ` ${o2.unit}` : ""}`} />;
  };
  const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 })}`;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const PALETTE = ["#1a8cff", "#f5a623", "#8bc34a", "#ec4899", "#ff5a43", "#9a9a9a"];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Movies" href="/admin/movies" {...o.movies} />
        <Stat label="TV shows" href="/admin/shows" {...o.shows} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {one("Viewing activity", (d) => d.plays, "#8b5cf6", { type: "area", unit: "plays" })}
        {one("Active viewers", (d) => d.viewers, "#1a8cff", { unit: "viewer-days" })}
        {one("New sign-ups", (d) => d.signups, "#8bc34a", { unit: "users" })}
        {one("Data served (est.)", (d) => d.gb, "#f5a623", { digits: 1, unit: "GB" })}
        {one("CDN cost (est.)", (d) => d.cost, "#ff5a43", { type: "area", digits: 2, money: true })}
        {one("Watch time", (d) => d.hours, "#ec4899", { digits: 1, unit: "h" })}
      </div>
      <p className="mt-2 text-sm">
        Data and cost are estimates from watched time ({GB_PER_HOUR} GB per hour, ${COST_PER_GB} per GB); actual CDN traffic is not recorded.
      </p>
      <section>
        <h2>OpenRouter</h2>
        {!or.ok ? (
          <>
            {or.key && (
              <div className="mb-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Today", or.key.daily],
                  ["This week", or.key.weekly],
                  ["This month", or.key.monthly],
                  ["All time", or.key.total],
                ].map(([label, v]) => (
                  <div key={label} className="stat">
                    <h3 className="text-sm font-semibold">{label}</h3>
                    <strong>{usd(v as number)}</strong>
                    {label === "All time" && or.key?.limit != null && (
                      <small>
                        {usd(or.key.remaining ?? 0)} left of {usd(or.key.limit)} limit
                      </small>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="text-sm">{or.message}</p>
          </>
        ) : (
          <>
            {or.credits && (
              <p className="mb-3 text-sm">
                Credits used {usd(or.credits.used)} of {usd(or.credits.total)} - {usd(or.credits.total - or.credits.used)} left
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <StackChart
                title="Spend"
                days={or.days}
                type="area"
                format={(n) => `$${n.toFixed(n < 1 ? 2 : 0)}`}
                total={usd(sum(or.spend) + sum(or.byok))}
                series={[
                  { key: "byok", label: "BYOK", color: "#f5a623", values: or.byok },
                  { key: "spend", label: "OpenRouter spend", color: "#8b5cf6", values: or.spend },
                ]}
              />
              <StackChart
                title="Request volume by model"
                days={or.days}
                total={`${sum(or.models.flatMap((m) => m.values)).toLocaleString("en-US")} requests`}
                series={or.models.map((m, i) => ({ key: m.model, label: m.model, color: PALETTE[i % PALETTE.length], values: m.values }))}
              />
              <StackChart
                title="Token breakdown"
                days={or.days}
                total={`${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(sum(or.prompt) + sum(or.completion) + sum(or.reasoning))} tokens`}
                series={[
                  { key: "reasoning", label: "Reasoning", color: "#ff5a43", values: or.reasoning },
                  { key: "completion", label: "Completion", color: "#8b5cf6", values: or.completion },
                  { key: "prompt", label: "Prompt", color: "#1a8cff", values: or.prompt },
                ]}
              />
            </div>
          </>
        )}
      </section>
      {o.recentMovies.length > 0 && (
        <section>
          <h2>Recent movies</h2>
          <TitleRows kind="movies" rows={o.recentMovies} />
        </section>
      )}
      {o.recentShows.length > 0 && (
        <section>
          <h2>Recent shows</h2>
          <TitleRows kind="shows" rows={o.recentShows} />
        </section>
      )}
    </>
  );
}
