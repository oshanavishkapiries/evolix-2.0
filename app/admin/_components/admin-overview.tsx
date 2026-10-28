import Link from "next/link";
import { adminAnalytics, adminOverview, COST_PER_GB, GB_PER_HOUR } from "@/lib/cms/stats";
import { errorSummary } from "@/lib/errors/queries";
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
  const [o, days, errs] = await Promise.all([adminOverview(), adminAnalytics(), errorSummary().catch(() => null)]);
  const labels = days.map((d) => d.day);
  const one = (title: string, f: (d: (typeof days)[number]) => number, color: string, o2: { type?: "bar" | "area"; digits?: number; unit?: string; money?: boolean } = {}) => {
    const values = days.map(f);
    const sum = values.reduce((a, b) => a + b, 0);
    const d = o2.digits ?? 0;
    const num = (n: number) => `${o2.money ? "$" : ""}${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
    return <StackChart title={title} days={labels} type={o2.type} series={[{ key: title, label: "", color, values }]} format={(n) => num(n)} total={`${num(sum)}${o2.unit ? ` ${o2.unit}` : ""}`} />;
  };
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Movies" href="/admin/movies" {...o.movies} />
        <Stat label="TV shows" href="/admin/shows" {...o.shows} />
        {errs && (
          <div className="stat">
            <h2 className="text-base">
              <Link href="/admin/errors">Errors</Link>
            </h2>
            <strong style={errs.open ? { color: "#ff8a7a" } : undefined}>{errs.open}</strong>
            <small>
              open - {errs.new24} new, {errs.events24} events since yesterday
            </small>
          </div>
        )}
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
      <p className="mt-4 text-sm">
        OpenRouter spend and the translation model moved to <Link href="/admin/openrouter">OpenRouter</Link>.
      </p>
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
