import Link from "next/link";
import { adminOverview } from "@/lib/cms/stats";
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
  const o = await adminOverview();
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Movies" href="/admin/movies" {...o.movies} />
        <Stat label="TV shows" href="/admin/shows" {...o.shows} />
      </div>
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
