import Link from "next/link";
import { Suspense } from "react";
import { browse, SEARCH_PAGE_SIZE, SORTS, type Sort } from "@/lib/viewer/catalog";
import type { CardKind } from "@/lib/viewer/ids";
import { GridSkeleton } from "./skeletons";
import { NavMarker } from "./nav-marker";
import { PosterCard } from "./poster-card";

type Raw = Record<string, string | string[] | undefined>;

const SORT_LABEL: Record<Sort, string> = { newest: "Newest", title: "Title", year: "Year" };

function parse(raw: Raw) {
  const one = (k: string) => {
    const v = raw[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const sort = (SORTS as string[]).includes(one("sort")) ? (one("sort") as Sort) : "newest";
  const page = Math.min(1000, Math.max(1, Math.trunc(Number(one("page"))) || 1));
  return { sort, page };
}

/** Full-catalog grid for one kind (the /movies and /tv pages). */
export function BrowsePage({
  kind,
  basePath,
  heading,
  searchParams,
}: {
  kind: CardKind;
  basePath: string;
  heading: string;
  searchParams: Promise<Raw>;
}) {
  return (
    <div className="v-page">
      <NavMarker active={kind === "movie" ? "movies" : "tv"} />
      <h1 className="v-page-title">{heading}</h1>
      <Suspense fallback={<GridSkeleton count={12} />}>
        <Content kind={kind} basePath={basePath} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Content({ kind, basePath, searchParams }: { kind: CardKind; basePath: string; searchParams: Promise<Raw> }) {
  const { sort, page } = parse(await searchParams);
  const href = (patch: { sort?: Sort; page?: number }) => {
    const n = { sort, page, ...patch };
    const qs = new URLSearchParams();
    if (n.sort !== "newest") qs.set("sort", n.sort);
    if (n.page > 1) qs.set("page", String(n.page));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const { items, total } = await browse({
    type: kind,
    sort,
    limit: SEARCH_PAGE_SIZE,
    offset: (page - 1) * SEARCH_PAGE_SIZE,
    withTotal: true,
  });
  const pages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));

  return (
    <>
      <nav className="v-filters" aria-label="Sort">
        <span className="v-seg" role="group" aria-label="Sort">
          {SORTS.map((s) => (
            <Link key={s} href={href({ sort: s, page: 1 })} aria-current={sort === s} replace>
              {SORT_LABEL[s]}
            </Link>
          ))}
        </span>
        <span className="v-muted" role="status" style={{ fontSize: ".9rem" }}>
          {total} {total === 1 ? "title" : "titles"}
        </span>
      </nav>
      {!items.length ? (
        <div className="v-empty" style={{ minHeight: "30dvh" }}>
          <p className="v-muted">Nothing has been published yet.</p>
        </div>
      ) : (
        <ul className="v-grid">
          {items.map((item) => (
            <li key={item.id}>
              <PosterCard item={item} />
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav className="v-pager" aria-label="Pagination">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="v-btn" rel="prev">Previous</Link> : <span className="v-btn" aria-disabled="true">Previous</span>}
          <span className="v-muted">Page {page} of {pages}</span>
          {page < pages ? <Link href={href({ page: page + 1 })} className="v-btn" rel="next">Next</Link> : <span className="v-btn" aria-disabled="true">Next</span>}
        </nav>
      )}
    </>
  );
}
