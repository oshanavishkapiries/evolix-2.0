"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { useDebouncedSearch } from "@/lib/client/use-debounced";
import { SearchInput } from "./search-input";
import { TitleRows, type TitleKind, type TitleRow } from "./title-rows";

const PAGE_SIZE = 20;
type Status = "" | "published" | "draft";
type Listing = { rows: TitleRow[]; total: number };

/** Searchable, filterable, paged list. State lives in ?q=&status=&page= (replaceState, no history spam). */
export function TitleList({ kind }: { kind: TitleKind }) {
  const params = useSearchParams();
  const [status, setStatus] = useState<Status>(() => {
    const s = params.get("status");
    return s === "published" || s === "draft" ? s : "";
  });
  const [page, setPage] = useState(() => Math.max(1, Number(params.get("page")) || 1));
  const noun = kind === "movies" ? "movies" : "shows";

  const search = useDebouncedSearch<Listing>(
    async (term, signal) => {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (term) qs.set("q", term);
      if (status) qs.set("status", status);
      const res = await adminApi<Record<string, unknown>>("GET", `/api/admin/${kind}?${qs}`, undefined, signal);
      if (!res.ok) throw new Error(errorText(res));
      return { rows: res[kind] as TitleRow[], total: res.total as number };
    },
    { initialQuery: params.get("q") ?? "", allowEmpty: true, extraKey: `${status}|${page}` },
  );
  const { term } = search;

  useEffect(() => {
    const qs = new URLSearchParams();
    if (term) qs.set("q", term);
    if (status) qs.set("status", status);
    if (page > 1) qs.set("page", String(page));
    const s = qs.toString();
    window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
  }, [term, status, page]);

  const data = search.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filtered = Boolean(term || status);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <SearchInput
          label={`Search ${noun}`}
          value={search.query}
          onChange={(v) => {
            search.setQuery(v);
            setPage(1);
          }}
          onSubmit={search.submit}
          loading={search.loading}
          tooShort={search.tooShort}
          placeholder="Title or original title"
        />
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as Status);
              setPage(1);
            }}
          >
            <option value="">All</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </label>
      </div>
      {search.error && <p role="alert">{search.error}</p>}
      {data === null ? (
        !search.error && (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-[70px]" />
            ))}
          </div>
        )
      ) : data.rows.length === 0 ? (
        <div className="card text-center">
          <p>{filtered ? `No ${noun} match your filters.` : `No ${noun} yet.`}</p>
          {!filtered && (
            <Link href={`/admin/${kind}/new`} className="mt-2 inline-block">
              Add the first one from TMDB
            </Link>
          )}
        </div>
      ) : (
        <div className={search.loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={search.loading}>
          <TitleRows kind={kind} rows={data.rows} />
          <p className="toolbar mt-3 justify-between text-sm">
            <span aria-live="polite">
              {data.total} {data.total === 1 ? "result" : "results"} - page {page} of {totalPages}
            </span>
            <span className="toolbar">
              <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button type="button" className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </span>
          </p>
        </div>
      )}
    </>
  );
}
