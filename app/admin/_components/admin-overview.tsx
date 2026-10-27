import Link from "next/link";
import { adminAnalytics, adminOverview, COST_PER_GB, GB_PER_HOUR } from "@/lib/cms/stats";
import { BarChart } from "./bar-chart";
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
  const [o, days] = await Promise.all([adminOverview(), adminAnalytics()]);
  const series = (f: (d: (typeof days)[number]) => number) => days.map((d) => ({ label: d.day, value: f(d) }));
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Movies" href="/admin/movies" {...o.movies} />
        <Stat label="TV shows" href="/admin/shows" {...o.shows} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <BarChart title="Viewing activity" unit="plays" bars={series((d) => d.plays)} />
        <BarChart title="Active viewers" unit="viewer-days" bars={series((d) => d.viewers)} />
        <BarChart title="New sign-ups" unit="users" bars={series((d) => d.signups)} />
        <BarChart title="Data served (est.)" unit="GB" digits={1} bars={series((d) => d.gb)} />
        <BarChart title="CDN cost (est.)" unit="$" digits={2} bars={series((d) => d.cost)} />
        <BarChart title="Watch time" unit="h" digits={1} bars={series((d) => d.hours)} />
      </div>
      <p className="mt-2 text-sm">
        Data and cost are estimates from watched time ({GB_PER_HOUR} GB per hour, ${COST_PER_GB} per GB); actual CDN traffic is not recorded.
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
