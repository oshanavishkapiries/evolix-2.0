"use client";

import { useState } from "react";
import { adminApi, errorText, tmdbImage } from "@/lib/client/admin";
import { SEARCH_MIN_CHARS, useDebouncedSearch } from "@/lib/client/use-debounced";
import { SearchInput } from "./search-input";

type Result = {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  overview: string;
  alreadyAdded: boolean;
  localId: string | null;
};
type Found = { results: Result[]; totalPages: number };

/** Step 1 of the new flows: debounced TMDB search with result cards. */
export function SearchPicker({ type, onSelect, busy }: { type: "movie" | "tv"; onSelect: (tmdbId: number) => void; busy?: boolean }) {
  const [page, setPage] = useState(1);
  const base = type === "movie" ? "/admin/movies" : "/admin/shows";

  const search = useDebouncedSearch<Found>(
    async (term, signal) => {
      const qs = new URLSearchParams({ type, query: term, page: String(page) });
      const res = await adminApi<Found>("GET", `/api/admin/tmdb/search?${qs}`, undefined, signal);
      if (!res.ok) throw new Error(errorText(res));
      return { results: res.results, totalPages: res.totalPages };
    },
    { extraKey: String(page) },
  );
  const data = search.data;

  return (
    <section className="card space-y-4">
      <SearchInput
        label={type === "movie" ? "Search TMDB for a movie" : "Search TMDB for a TV show"}
        value={search.query}
        onChange={(v) => {
          search.setQuery(v);
          setPage(1);
        }}
        onSubmit={search.submit}
        loading={search.loading}
        tooShort={search.tooShort}
        placeholder="Start typing a title..."
        autoFocus
      />
      {search.error && <p role="alert">{search.error}</p>}
      {!data && !search.error && !search.loading && !search.tooShort && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Type at least {SEARCH_MIN_CHARS} characters. Results appear as you type; press Enter to search right away.
        </p>
      )}
      {data && data.results.length === 0 && !search.loading && <p role="status">No results for &ldquo;{search.term}&rdquo;.</p>}
      {data && data.results.length > 0 && (
        <div className={search.loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={search.loading}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.results.map((r) => (
              <li key={r.tmdbId} className="flex gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                {tmdbImage(r.posterPath) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tmdbImage(r.posterPath)!} alt={`Poster of ${r.title}`} width={92} className="poster shrink-0 self-start" />
                ) : (
                  <span className="poster aspect-[2/3] shrink-0 self-start bg-gray-200 dark:bg-gray-800" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <p>
                    <strong>{r.title}</strong> ({r.year ?? "n/a"}) <small>TMDB {r.tmdbId}</small>
                  </p>
                  <p className="line-clamp-4 text-sm">{r.overview}</p>
                  {r.alreadyAdded ? (
                    <p className="text-sm">
                      Already added. <a href={`${base}/${r.localId}`}>Open it</a>
                    </p>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => onSelect(r.tmdbId)}>
                      Select
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="toolbar mt-3">
            <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span className="text-sm">
              Page {page} of {data.totalPages}
            </span>
            <button type="button" className="btn-secondary" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </p>
        </div>
      )}
    </section>
  );
}
