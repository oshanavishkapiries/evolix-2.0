import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { browse, listFeatured, listGenres, listLatest } from "@/lib/viewer/catalog";
import { NavMarker } from "../_components/nav-marker";
import { currentUserId } from "@/lib/viewer/user";
import { continueWatching, listBookmarks } from "@/lib/viewer/library";
import { ContinueRow } from "../_components/continue-row";
import { HubRow } from "../_components/hub-row";
import { PageHeader } from "../_components/page-header";
import { LibrarySkeleton } from "../_components/skeletons";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return (
    <div className="v-page v-page-rows">
      <NavMarker active="dashboard" />
      <PageHeader title="Home" />
      <Suspense fallback={<LibrarySkeleton />}>
        <HomeContent />
      </Suspense>
    </div>
  );
}

async function HomeContent() {
  const userId = await currentUserId();
  const [featured, movies, shows, genres, resume, myList] = await Promise.all([
    listFeatured(),
    listLatest("movie"),
    listLatest("show"),
    listGenres(),
    userId ? continueWatching(userId) : [],
    userId ? listBookmarks(userId, 20) : [],
  ]);
  const genreRows = await Promise.all(genres.map(async (g) => ({ genre: g, items: (await browse({ genre: g, limit: 20 })).items })));

  if (!featured.length && !movies.length && !shows.length) {
    return (
      <div className="v-empty">
        <h2>Your library is empty</h2>
        <p className="v-muted">Nothing has been published yet. Check back soon.</p>
      </div>
    );
  }

  return (
    <>
      <HubRow title="Featured" subtitle="New on Evolix" items={featured} variant="landscape" badge />
      <ContinueRow items={resume} />
      <HubRow title="My List" subtitle="Saved for later" items={myList} href="/my-list" badge />
      <HubRow title="Recently Added Movies" subtitle="Movies" items={movies} href="/movies" />
      <HubRow title="Recently Added Shows" subtitle="TV Shows" items={shows} href="/tv" />
      {genreRows.map((r) => (
        <HubRow key={r.genre} title={r.genre} subtitle="Movies & Shows" items={r.items} href={`/search?genre=${encodeURIComponent(r.genre)}`} badge />
      ))}
      <p style={{ textAlign: "center", marginTop: "2.5rem" }}>
        <Link href="/search" className="v-btn">Browse everything</Link>
      </p>
    </>
  );
}
