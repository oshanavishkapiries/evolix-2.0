import Link from "next/link";
import { Suspense } from "react";
import { imageUrl } from "@/lib/images";
import { browse, listGenres, listGenreTiles, SEARCH_PAGE_SIZE, SORTS, type Scope, type Sort } from "@/lib/viewer/catalog";
import type { CardKind } from "@/lib/viewer/ids";
import { HubRow } from "./hub-row";
import { KidsNav } from "./kids-nav";
import { MediaCard } from "./media-card";
import { PageHeader } from "./page-header";
import { GridSkeleton, RowSkeleton } from "./skeletons";
import { CardSizeSlider, ViewToggle } from "./view-controls";
import { resolveView, viewCookie } from "./view-prefs";
import { PageMotion, Reveal, SkeletonOut } from "./motion";

type Raw = Record<string, string | string[] | undefined>;

const SORT_LABEL: Record<Sort, string> = { newest: "Recently added", title: "Title", year: "Release year" };

function parse(raw: Raw) {
  const one = (k: string) => {
    const v = raw[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const sort = (SORTS as string[]).includes(one("sort")) ? (one("sort") as Sort) : "newest";
  const page = Math.min(1000, Math.max(1, Math.trunc(Number(one("page"))) || 1));
  return { sort, page, tab: one("tab") === "genres" ? ("genres" as const) : ("browse" as const), view: one("view") || undefined };
}
type Query = ReturnType<typeof parse>;

/** Movies / TV page: Browse (rows or grid) and Genres tabs. */
export function BrowsePage({ kind, basePath, heading, searchParams, scope = "main" }: { kind: CardKind; basePath: string; heading: string; searchParams: Promise<Raw>; scope?: Scope }) {
  return (
    <PageMotion>
    <div className="v-page v-page-rows">
      <Suspense fallback={<SkeletonOut><PageHeader title={heading} /><RowSkeleton /><RowSkeleton /></SkeletonOut>}>
        <Reveal><Content kind={kind} basePath={basePath} heading={heading} searchParams={searchParams} scope={scope} /></Reveal>
      </Suspense>
    </div>
    </PageMotion>
  );
}

async function Content({ kind, basePath, heading, searchParams, scope }: { kind: CardKind; basePath: string; heading: string; searchParams: Promise<Raw>; scope: Scope }) {
  const q = parse(await searchParams);
  const pageKey = scope === "kids" ? (kind === "movie" ? "kids-movies" : "kids-tv") : kind === "movie" ? "movies" : "tv";
  const view = await resolveView(pageKey, q.view, "rows");
  const href = (patch: Partial<Query>) => {
    const n = { ...q, view, ...patch };
    const qs = new URLSearchParams();
    if (n.tab === "genres") qs.set("tab", "genres");
    else {
      qs.set("view", n.view);
      if (n.view === "grid" && n.sort !== "newest") qs.set("sort", n.sort);
      if (n.view === "grid" && n.page > 1) qs.set("page", String(n.page));
    }
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const tabs = [
    { href: href({ tab: "browse" }), label: "Browse", current: q.tab === "browse" },
    { href: href({ tab: "genres" }), label: "Genres", current: q.tab === "genres" },
  ];
  const controls = (
    <>
      <CardSizeSlider />
      {q.tab === "browse" && <ViewToggle cookie={viewCookie(pageKey)} current={view} rowsHref={href({ view: "rows", page: 1 })} gridHref={href({ view: "grid" })} />}
    </>
  );

  return (
    <>
      <PageHeader title={heading} subtitle={scope === "kids" ? "Kids" : "On Evolix"} tabs={tabs} controls={controls} />
      {scope === "kids" && <div className="v-page-pad"><KidsNav current={kind === "movie" ? "movies" : "tv"} /></div>}
      {q.tab === "genres" ? (
        <Genres kind={kind} scope={scope} />
      ) : view === "rows" ? (
        <Rows kind={kind} scope={scope} />
      ) : (
        <div className="v-page-pad">
          <Suspense key={`${q.sort}|${q.page}`} fallback={<GridSkeleton />}>
            <Grid kind={kind} query={q} href={href} scope={scope} />
          </Suspense>
        </div>
      )}
    </>
  );
}

const searchBase = (scope: Scope) => (scope === "kids" ? "/kids/search" : "/search");

async function Rows({ kind, scope }: { kind: CardKind; scope: Scope }) {
  const [latest, genres] = await Promise.all([browse({ type: kind, limit: 20, scope }), listGenres(2, 10, kind, scope)]);
  if (!latest.items.length) return <Empty />;
  const rows = await Promise.all(genres.map(async (g) => ({ genre: g, items: (await browse({ type: kind, genre: g, limit: 20, scope })).items })));
  const label = kind === "movie" ? "Movies" : "TV Shows";
  return (
    <>
      <HubRow title="Recently Added" subtitle={label} items={latest.items} />
      {rows.map((r) => (
        <HubRow key={r.genre} title={r.genre} subtitle={label} items={r.items} href={`${searchBase(scope)}?type=${kind}&genre=${encodeURIComponent(r.genre)}`} />
      ))}
    </>
  );
}

async function Grid({ kind, query, href, scope }: { kind: CardKind; query: Query; href: (p: Partial<Query>) => string; scope: Scope }) {
  const { sort, page } = query;
  const { items, total } = await browse({ type: kind, sort, limit: SEARCH_PAGE_SIZE, offset: (page - 1) * SEARCH_PAGE_SIZE, withTotal: true, scope });
  const pages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));
  if (!items.length) return <Empty />;
  return (
    <>
      <div className="v-grid-bar">
        <span className="v-muted" role="status">{total} {total === 1 ? "title" : "titles"}</span>
        <details className="v-more">
          <summary>Sort: {SORT_LABEL[sort]}</summary>
          <ul role="menu">
            {SORTS.map((s) => (
              <li key={s}>
                <Link href={href({ sort: s, page: 1 })} aria-current={sort === s} role="menuitem" replace>{SORT_LABEL[s]}</Link>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <ul className="v-grid">
        {items.map((item) => (
          <li key={item.id}>
            <MediaCard item={item} />
          </li>
        ))}
      </ul>
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

async function Genres({ kind, scope }: { kind: CardKind; scope: Scope }) {
  const tiles = await listGenreTiles(kind, scope);
  if (!tiles.length) return <Empty />;
  return (
    <ul className="v-genres v-page-pad">
      {tiles.map((t) => {
        const src = imageUrl(t.backdropPath, "w780");
        return (
          <li key={t.genre}>
            <Link href={`${searchBase(scope)}?type=${kind}&genre=${encodeURIComponent(t.genre)}`} className="v-genre">
              {src && (
                // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
                <img src={src} alt="" width={780} height={439} loading="lazy" decoding="async" />
              )}
              <span className="v-genre-name">{t.genre}</span>
              <span className="v-genre-count">{t.count} {t.count === 1 ? "title" : "titles"}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const Empty = () => (
  <div className="v-empty" style={{ minHeight: "40dvh" }}>
    <p className="v-muted">Nothing has been published yet.</p>
  </div>
);
