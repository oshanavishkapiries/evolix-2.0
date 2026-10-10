import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { currentUserId } from "@/lib/viewer/user";
import { listBookmarks } from "@/lib/viewer/library";
import { NavMarker } from "../_components/nav-marker";
import { MediaCard } from "../_components/media-card";
import { GridSkeleton } from "../_components/skeletons";

export const metadata: Metadata = { title: "My List" };

export default function MyListPage() {
  return (
    <div className="v-page">
      <NavMarker active="my-list" />
      <h1 className="v-page-title">My List</h1>
      <Suspense fallback={<GridSkeleton count={12} />}>
        <Items />
      </Suspense>
    </div>
  );
}

async function Items() {
  const userId = await currentUserId();
  const items = userId ? await listBookmarks(userId) : [];
  if (!items.length) {
    return (
      <div className="v-empty" style={{ minHeight: "40dvh" }}>
        <h2>Your list is empty</h2>
        <p className="v-muted">Use the bookmark button on any movie or show to save it here.</p>
        <Link href="/dashboard" className="v-btn">Browse the library</Link>
      </div>
    );
  }
  return (
    <ul className="v-grid">
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`}>
          <MediaCard item={item} badge />
        </li>
      ))}
    </ul>
  );
}
