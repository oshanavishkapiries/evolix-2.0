import Link from "next/link";
import { Suspense } from "react";
import {
  browse,
  MIN_QUERY,
  SEARCH_PAGE_SIZE,
  SORTS,
  type Scope,
  type Sort,
  type TypeFilter,
} from "@/lib/viewer/catalog";
import { GridSkeleton } from "./skeletons";
import { MediaCard } from "./media-card";
import { KidsNav } from "./kids-nav";
import { PageHeader } from "./page-header";
import { SearchBar } from "./search-bar";
import { CardSizeSlider } from "./view-controls";
import { PageMotion, Reveal, SkeletonOut } from "./motion";

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

function href(base: Query, patch: Partial<Query>, path: string) {
  const n = { ...base, ...patch };
  const qs = new URLSearchParams();
  if (n.q) qs.set("q", n.q);
  if (n.type !== "all") qs.set("type", n.type);
  if (n.sort !== "newest") qs.set("sort", n.sort);
  if (n.genre) qs.set("genre", n.genre);
  if (n.page > 1) qs.set("page", String(n.page));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/** Search page body; the Kids section reuses it with its own path and scope. */
export function SearchView({ searchParams, scope = "main" }: { searchParams: Promise<Raw>; scope?: Scope }) {
  return (
    <PageMotion>
    <div className="v-page">
      <PageHeader title="Search" subtitle={scope === "kids" ? "Kids" : "Movies & Shows"} controls={<CardSizeSlider />} />
      {scope === "kids" && <div className="v-page-pad"><KidsNav current="search" /></div>}
      <Suspense fallback={<SkeletonOut><GridSkeleton count={12} /></SkeletonOut>}>
        <Reveal><SearchContent searchParams={searchParams} scope={scope} /></Reveal>
      </Suspense>
    </div>
    </PageMotion>
  );
}

async function SearchContent({ searchParams, scope }: { searchParams: Promise<Raw>; scope: Scope }) {
  const path = scope === "kids" ? "/kids/search" : "/search";
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
            <Link key={t} href={href(query, { type: t, page: 1 }, path)} aria-current={type === t} replace>
              {t === "all" ? "All" : t === "movie" ? "Movies" : "Shows"}
            </Link>
          ))}
        </span>
        <span className="v-seg" role="group" aria-label="Sort">
          {SORTS.map((s) => (
            <Link key={s} href={href(query, { sort: s, page: 1 }, path)} aria-current={sort === s} replace>
              {s === "newest" ? "Newest" : s === "title" ? "Title" : "Year"}
            </Link>
          ))}
        </span>
        {genre && (
          <Link href={href(query, { genre: "", page: 1 }, path)} className="v-chip" replace>
            {genre} ✕
          </Link>
        )}
      </nav>
      <Suspense key={`${q}|${type}|${sort}|${genre}|${page}`} fallback={<GridSkeleton />}>
        <Results query={query} scope={scope} path={path} />
      </Suspense>
    </>
  );
}

async function Results({ query, scope, path }: { query: Query; scope: Scope; path: string }) {
  const { q, type, sort, genre, page } = query;
  const { items, total } = await browse({
    q,
    type,
    sort,
    genre: genre || undefined,
    limit: SEARCH_PAGE_SIZE,
    offset: (page - 1) * SEARCH_PAGE_SIZE,
    withTotal: true,
    scope,
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
          {page > 1 ? <Link href={href(query, { page: page - 1 }, path)} className="v-btn" rel="prev">Previous</Link> : <span className="v-btn" aria-disabled="true">Previous</span>}
          <span className="v-muted">Page {page} of {pages}</span>
          {page < pages ? <Link href={href(query, { page: page + 1 }, path)} className="v-btn" rel="next">Next</Link> : <span className="v-btn" aria-disabled="true">Next</span>}
        </nav>
      )}
    </>
  );
}
