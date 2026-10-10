"use client";

import { FormEvent, useState } from "react";
import { adminApi, errorText, tmdbImage } from "@/lib/client/admin";

type Result = {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  overview: string;
  alreadyAdded: boolean;
  localId: string | null;
};

export function SearchPicker({
  type,
  onSelect,
}: {
  type: "movie" | "tv";
  onSelect: (tmdbId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = type === "movie" ? "/admin/movies" : "/admin/shows";

  async function run(p: number) {
    setBusy(true);
    setError("");
    const qs = new URLSearchParams({ type, query: query.trim(), page: String(p) });
    const res = await adminApi<{ results: Result[]; totalPages: number }>(
      "GET",
      `/api/admin/tmdb/search?${qs}`,
    );
    setBusy(false);
    if (!res.ok) return setError(errorText(res));
    setResults(res.results);
    setPage(p);
    setTotalPages(res.totalPages);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (query.trim()) void run(1);
  }

  return (
    <section>
      <form onSubmit={onSubmit} role="search">
        <p>
          <label>
            Search TMDB{" "}
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>{" "}
          <button type="submit" disabled={busy}>
            Search
          </button>
        </p>
      </form>
      {error && <p role="alert">{error}</p>}
      {results && results.length === 0 && <p role="status">No results.</p>}
      {results && results.length > 0 && (
        <>
          <ul>
            {results.map((r) => (
              <li key={r.tmdbId}>
                {tmdbImage(r.posterPath) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tmdbImage(r.posterPath)!} alt={`Poster of ${r.title}`} width={92} />
                )}
                <strong>{r.title}</strong> ({r.year ?? "n/a"}) <small>TMDB {r.tmdbId}</small>
                <p>{r.overview}</p>
                {r.alreadyAdded ? (
                  <p role="status">
                    Already added. <a href={`${base}/${r.localId}`}>Open it</a>
                  </p>
                ) : (
                  <button type="button" onClick={() => onSelect(r.tmdbId)}>
                    Select
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p>
            <button type="button" disabled={busy || page <= 1} onClick={() => run(page - 1)}>
              Previous
            </button>{" "}
            Page {page} of {totalPages}{" "}
            <button type="button" disabled={busy || page >= totalPages} onClick={() => run(page + 1)}>
              Next
            </button>
          </p>
        </>
      )}
    </section>
  );
}
