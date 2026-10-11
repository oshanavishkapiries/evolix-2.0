import type { Metadata } from "next";
import { Suspense } from "react";
import { browse, listFeatured, listGenres, listLatest } from "@/lib/viewer/catalog";
import { continueWatching, listBookmarks } from "@/lib/viewer/library";
import { currentUserId } from "@/lib/viewer/user";
import { ContinueRow } from "../_components/continue-row";
import { HubRow } from "../_components/hub-row";
import { KidsNav } from "../_components/kids-nav";
import { PageMotion, Reveal, SkeletonOut } from "../_components/motion";
import { PageHeader } from "../_components/page-header";
import { LibrarySkeleton } from "../_components/skeletons";

export const metadata: Metadata = { title: "Kids" };

export default function KidsHomePage() {
  return (
    <PageMotion>
    <div className="v-page v-page-rows">
      <PageHeader title="Kids" subtitle="Movies & shows for kids" />
      <div className="v-page-pad"><KidsNav current="home" /></div>
      <Suspense fallback={<SkeletonOut><LibrarySkeleton /></SkeletonOut>}>
        <Reveal><KidsContent /></Reveal>
      </Suspense>
    </div>
    </PageMotion>
  );
}

async function KidsContent() {
  const userId = await currentUserId();
  const [featured, movies, shows, genres, resume, myList] = await Promise.all([
    listFeatured(10, "kids"),
    listLatest("movie", 20, "kids"),
    listLatest("show", 20, "kids"),
    listGenres(2, 4, undefined, "kids"),
    userId ? continueWatching(userId, 20, "kids") : [],
    userId ? listBookmarks(userId, 20, "kids") : [],
  ]);
  const genreRows = await Promise.all(genres.map(async (g) => ({ genre: g, items: (await browse({ genre: g, limit: 20, scope: "kids" })).items })));

  if (!featured.length && !movies.length && !shows.length) {
    return (
      <div className="v-empty">
        <h2>Nothing here yet</h2>
        <p className="v-muted">No titles have been added to the Kids section. Check back soon.</p>
      </div>
    );
  }

  return (
    <>
      <HubRow title="Featured" subtitle="New for kids" items={featured} variant="landscape" badge logo />
      <ContinueRow items={resume} />
      <HubRow title="My List" subtitle="Saved for later" items={myList} badge />
      <HubRow title="Kids Movies" subtitle="Movies" items={movies} href="/kids/movies" />
      <HubRow title="Kids Shows" subtitle="TV Shows" items={shows} href="/kids/tv" />
      {genreRows.map((r) => (
        <HubRow key={r.genre} title={r.genre} subtitle="Movies & Shows" items={r.items} href={`/kids/search?genre=${encodeURIComponent(r.genre)}`} badge />
      ))}
    </>
  );
}
