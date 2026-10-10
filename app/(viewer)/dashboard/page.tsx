import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { browse, getHero, listGenres, listLatest } from "@/lib/viewer/catalog";
import { ContentRow } from "../_components/content-row";
import { LibrarySkeleton } from "../_components/skeletons";
import { TitleHero } from "../_components/title-hero";
import { detailHref } from "@/lib/viewer/format";

export const metadata: Metadata = { title: "Dashboard" };

export default function LibraryPage() {
  return (
    <>
      <h1 className="v-sr">Dashboard</h1>
      <span data-nav="dashboard" hidden />
      <Suspense fallback={<LibrarySkeleton />}>
        <LibraryContent />
      </Suspense>
    </>
  );
}

async function LibraryContent() {
  const [hero, movies, shows, genres] = await Promise.all([
    getHero(),
    listLatest("movie"),
    listLatest("show"),
    listGenres(),
  ]);
  const genreRows = await Promise.all(genres.map(async (g) => ({ genre: g, items: (await browse({ genre: g, limit: 20 })).items })));

  if (!hero && !movies.length && !shows.length) {
    return (
      <div className="v-empty">
        <h2>Your library is empty</h2>
        <p className="v-muted">Nothing has been published yet. Check back soon.</p>
      </div>
    );
  }

  return (
    <>
      {hero ? (
        <TitleHero
          {...hero}
          headingLevel={2}
          posterPath={null}
          playHref={hero.playHref}
          infoHref={detailHref(hero.kind, hero.id)}
        />
      ) : (
        <div style={{ height: "var(--v-nav-h)" }} />
      )}
      <ContentRow title="Recently added movies" items={movies} href="/search?type=movie" />
      <ContentRow title="Recently added shows" items={shows} href="/search?type=show" />
      {genreRows.map((r) => (
        <ContentRow key={r.genre} title={r.genre} items={r.items} href={`/search?genre=${encodeURIComponent(r.genre)}`} badge />
      ))}
      <p style={{ textAlign: "center", marginTop: "2.5rem" }}>
        <Link href="/search" className="v-btn">Browse everything</Link>
      </p>
    </>
  );
}
