import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  browse,
  MIN_QUERY,
  SEARCH_PAGE_SIZE,
  SORTS,
  type Sort,
  type TypeFilter,
} from "@/lib/viewer/catalog";
import { GridSkeleton } from "../_components/skeletons";
import { NavMarker } from "../_components/nav-marker";
import { MediaCard } from "../_components/media-card";
import { PageHeader } from "../_components/page-header";
import { SearchBar } from "../_components/search-bar";
import { CardSizeSlider } from "../_components/view-controls";

export const metadata: Metadata = { title: "Browse" };

type Raw = Record<string, string | string[] | undefined>;

function parse(raw: Raw) {
  const one = (k: string) => {
    const v = raw[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const q = one("q").trim().slice(0, 100);
  const type: TypeFilter = one("type") === "movie" ? "movie" : one("type") === "show" ? "show" : "all";
  const sort = (SORTS as string[]).includes(one("sort")) ? (one("sort") as Sort) : "newest";
  const genre = one("genre").trim().slice(0, 50);
  const page = Math.min(1000, Math.max(1, Math.trunc(Number(one("page"))) || 1));
  return { q, type, sort, genre, page };
}
type Query = ReturnType<typeof parse>;

function href(base: Query, patch: Partial<Query>) {
  const n = { ...base, ...patch };
  const qs = new URLSearchParams();
  if (n.q) qs.set("q", n.q);
  if (n.type !== "all") qs.set("type", n.type);
  if (n.sort !== "newest") qs.set("sort", n.sort);
  if (n.genre) qs.set("genre", n.genre);
  if (n.page > 1) qs.set("page", String(n.page));
  const s = qs.toString();
  return s ? `/search?${s}` : "/search";
}

export default function SearchPage({ searchParams }: { searchParams: Promise<Raw> }) {
  return (
    <div className="v-page">
      <NavMarker active="search" />
      <PageHeader title="Search" subtitle="Movies & Shows" controls={<CardSizeSlider />} />
      <Suspense fallback={<GridSkeleton count={12} />}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SearchContent({ searchParams }: { searchParams: Promise<Raw> }) {
  const query = parse(await searchParams);
  const { q, type, sort, genre, page } = query;
  return (
    <>
      <Suspense>
        <SearchBar initial={q} />
      </Suspense>
      <nav className="v-filters" aria-label="Filters">
        <span className="v-seg" role="group" aria-label="Type">
          {(["all", "movie", "show"] as const).map((t) => (
            <Link key={t} href={href(query, { type: t, page: 1 })} aria-current={type === t} replace>
              {t === "all" ? "All" : t === "movie" ? "Movies" : "Shows"}
            </Link>
          ))}
        </span>
        <span className="v-seg" role="group" aria-label="Sort">
          {SORTS.map((s) => (
            <Link key={s} href={href(query, { sort: s, page: 1 })} aria-current={sort === s} replace>
              {s === "newest" ? "Newest" : s === "title" ? "Title" : "Year"}
            </Link>
          ))}
        </span>
        {genre && (
          <Link href={href(query, { genre: "", page: 1 })} className="v-chip" replace>
            {genre} ✕
          </Link>
        )}
      </nav>
      <Suspense key={`${q}|${type}|${sort}|${genre}|${page}`} fallback={<GridSkeleton />}>
        <Results query={query} />
      </Suspense>
    </>
  );
}

async function Results({ query }: { query: Query }) {
  const { q, type, sort, genre, page } = query;
  const { items, total } = await browse({
    q,
    type,
    sort,
    genre: genre || undefined,
    limit: SEARCH_PAGE_SIZE,
    offset: (page - 1) * SEARCH_PAGE_SIZE,
    withTotal: true,
  });
  const pages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));

  if (!items.length) {
    return (
      <div className="v-empty" style={{ minHeight: "30dvh" }}>
        <p className="v-muted" role="status">
          {q || genre ? `No results${q ? ` for "${q}"` : ""}.` : "Nothing has been published yet."}
        </p>
      </div>
    );
  }
  return (
    <>
      <p className="v-muted v-grid-bar" role="status" aria-live="polite">
        {total} {total === 1 ? "title" : "titles"}
        {q.length >= MIN_QUERY ? ` for "${q}"` : ""}
      </p>
      <ul className="v-grid">
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <MediaCard item={item} badge={type === "all"} />
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <nav className="v-pager" aria-label="Pagination">
          {page > 1 ? <Link href={href(query, { page: page - 1 })} className="v-btn" rel="prev">Previous</Link> : <span className="v-btn" aria-disabled="true">Previous</span>}
          <span className="v-muted">Page {page} of {pages}</span>
          {page < pages ? <Link href={href(query, { page: page + 1 })} className="v-btn" rel="next">Next</Link> : <span className="v-btn" aria-disabled="true">Next</span>}
        </nav>
      )}
    </>
  );
}
