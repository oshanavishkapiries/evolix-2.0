import { Suspense, cache } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { browse, featuredLogo, listFeatured, listGenres, listLatest, type Card } from "@/lib/viewer/catalog";
import { canWatch } from "@/lib/viewer/access";
import { currentUserId } from "@/lib/viewer/user";
import { continueWatching, listBookmarks } from "@/lib/viewer/library";
import { ApprovalNotice } from "./approval-notice";
import { ContinueRow } from "./continue-row";
import { HubRow } from "./hub-row";
import { MediaCard } from "./media-card";
import { ScrollRow } from "./scroll-row";
import { RowSkeleton } from "./skeletons";

/**
 * Rows read TMDB through the public catalog cache. An upstream failure must not fail the build or the page:
 * during prerender the row becomes a request-time hole (connection()), at request time it retries once and
 * then renders empty.
 */
async function resilient<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    await connection();
    return load().catch(() => fallback);
  }
}

// React cache deduplicates these reads only within the current server render.
const publicRows = cache(() => ({
  featured: resilient(() => listFeatured(), [] as Card[]),
  movies: resilient(() => listLatest("movie"), [] as Card[]),
  shows: resilient(() => listLatest("show"), [] as Card[]),
}));
const emptyLibrary = cache(async () => {
  const rows = publicRows();
  const items = await Promise.all([rows.featured, rows.movies, rows.shows]);
  return items.every((row) => row.length === 0);
});

export async function HomeApproval() {
  const userId = await currentUserId();
  if (!userId || await canWatch(userId) || await emptyLibrary()) return null;
  return <ApprovalNotice banner />;
}

export async function HomeEmpty() {
  if (!(await emptyLibrary())) return null;
  return <div className="v-empty"><h2>Your library is empty</h2><p className="v-muted">Nothing has been published yet. Check back soon.</p></div>;
}

async function FeaturedCard({ item, index }: { item: Card; index: number }) {
  const match = /^tmdb-(\d+)$/.exec(item.id);
  const logoPath = !item.logoPath && match ? await featuredLogo(item.kind, Number(match[1])) : item.logoPath;
  return <MediaCard item={{ ...item, logoPath }} variant="landscape" badge logo priority={index < 4} fetchPriority={index === 0 ? "high" : "auto"} />;
}

export async function HomeFeatured() {
  const items = await publicRows().featured;
  if (!items.length) return null;
  return (
    <ScrollRow label="Featured" variant="landscape" head={<><h2>Featured</h2><p>New on Evolix</p></>}>
      {items.map((item, index) => (
        <li key={`${item.kind}-${item.id}`}>
          <Suspense fallback={<MediaCard item={item} variant="landscape" badge logo priority={index < 4} fetchPriority={index === 0 ? "high" : "auto"} />}>
            <FeaturedCard item={item} index={index} />
          </Suspense>
        </li>
      ))}
    </ScrollRow>
  );
}

export async function HomeContinue() {
  const userId = await currentUserId();
  if (!userId) return null;
  const items = await continueWatching(userId);
  if (await emptyLibrary()) return null;
  return <ContinueRow items={items} />;
}

export async function HomeMyList() {
  const userId = await currentUserId();
  if (!userId) return null;
  const items = await listBookmarks(userId, 20);
  if (await emptyLibrary()) return null;
  return <HubRow title="My List" subtitle="Saved for later" items={items} href="/my-list" badge />;
}

export async function HomeLatest({ kind }: { kind: "movie" | "show" }) {
  const items = await publicRows()[kind === "movie" ? "movies" : "shows"];
  return <HubRow title={kind === "movie" ? "Recently Added Movies" : "Recently Added Shows"} subtitle={kind === "movie" ? "Movies" : "TV Shows"} items={items} href={kind === "movie" ? "/movies" : "/tv"} />;
}

async function HomeGenre({ genre }: { genre: string }) {
  const result = await resilient(() => browse({ genre, limit: 20 }), { items: [] as Card[], total: 0 });
  if (!result.items.length) return null;
  if (await emptyLibrary()) return null;
  return <HubRow title={genre} subtitle="Movies & Shows" items={result.items} href={`/search?genre=${encodeURIComponent(genre)}`} badge />;
}

export async function HomeGenres() {
  const genres = await listGenres();
  return genres.map((genre) => <Suspense key={genre} fallback={<RowSkeleton />}><HomeGenre genre={genre} /></Suspense>);
}

export async function HomeBrowseLink() {
  if (await emptyLibrary()) return null;
  return <p style={{ textAlign: "center", marginTop: "2.5rem" }}><Link href="/search" className="v-btn">Browse everything</Link></p>;
}
