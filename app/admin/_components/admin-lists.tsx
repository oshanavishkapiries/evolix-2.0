"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminApi, errorText, tmdbImage } from "@/lib/client/admin";

type Row = {
  id: string;
  title?: string;
  name?: string;
  releaseDate?: string | null;
  firstAirDate?: string | null;
  posterPath?: string | null;
  isPublished: boolean;
};
type Kind = "movies" | "shows";

const year = (d?: string | null) => (d ? d.slice(0, 4) : "n/a");

function useRows(kind: Kind) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      const res = await adminApi<Record<string, Row[]>>("GET", `/api/admin/${kind}`);
      if (res.ok) setRows(res[kind]);
      else setError(errorText(res));
    })();
  }, [kind]);
  return { rows, error };
}

function RowList({ kind, rows }: { kind: Kind; rows: Row[] }) {
  return (
    <ul className="rows">
      {rows.map((r) => {
        const label = r.title ?? r.name ?? "Untitled";
        const thumb = tmdbImage(r.posterPath, "w92");
        return (
          <li key={r.id}>
            <span className="flex min-w-0 items-center gap-3">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb} alt="" width={36} height={54} loading="lazy" className="h-[54px] w-9 shrink-0 rounded object-cover" />
              ) : (
                <span className="h-[54px] w-9 shrink-0 rounded bg-gray-200 dark:bg-gray-800" aria-hidden="true" />
              )}
              <span className="min-w-0 break-words">
                <Link href={`/admin/${kind}/${r.id}`}>{label}</Link> ({year(r.releaseDate ?? r.firstAirDate)})
              </span>
            </span>
            <span className={`badge ${r.isPublished ? "badge-on" : "badge-off"}`}>
              {r.isPublished ? "published" : "draft"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Full list page for movies or shows. */
export function TitleList({ kind }: { kind: Kind }) {
  const { rows, error } = useRows(kind);
  const noun = kind === "movies" ? "movies" : "shows";
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {rows === null ? (
        !error && <p>Loading...</p>
      ) : rows.length === 0 ? (
        <p>No {noun} yet.</p>
      ) : (
        <RowList kind={kind} rows={rows} />
      )}
    </>
  );
}

function Stats({ label, rows, href }: { label: string; rows: Row[] | null; href: string }) {
  const published = rows?.filter((r) => r.isPublished).length ?? 0;
  return (
    <div className="stat">
      <h2 className="text-base">
        <Link href={href}>{label}</Link>
      </h2>
      {rows === null ? (
        <p>Loading...</p>
      ) : (
        <>
          <strong>{rows.length}</strong>
          <small>
            {published} published, {rows.length - published} draft
          </small>
        </>
      )}
    </div>
  );
}

/** Overview: counts plus the most recent titles. */
export function AdminOverview() {
  const movies = useRows("movies");
  const shows = useRows("shows");
  const error = movies.error || shows.error;
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Stats label="Movies" rows={movies.rows} href="/admin/movies" />
        <Stats label="TV shows" rows={shows.rows} href="/admin/shows" />
      </div>
      {movies.rows && movies.rows.length > 0 && (
        <section>
          <h2>Recent movies</h2>
          <RowList kind="movies" rows={movies.rows.slice(0, 5)} />
        </section>
      )}
      {shows.rows && shows.rows.length > 0 && (
        <section>
          <h2>Recent shows</h2>
          <RowList kind="shows" rows={shows.rows.slice(0, 5)} />
        </section>
      )}
    </>
  );
}
