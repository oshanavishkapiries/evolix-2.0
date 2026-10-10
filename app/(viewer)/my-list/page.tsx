import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { currentUserId } from "@/lib/viewer/user";
import { listBookmarks } from "@/lib/viewer/library";
import { HubRow } from "../_components/hub-row";
import { MediaCard } from "../_components/media-card";
import { PageHeader } from "../_components/page-header";
import { GridSkeleton } from "../_components/skeletons";
import { CardSizeSlider, ViewToggle } from "../_components/view-controls";
import { resolveView, viewCookie } from "../_components/view-prefs";
import { PageMotion, Reveal, SkeletonOut } from "../_components/motion";

export const metadata: Metadata = { title: "My List" };

type Props = { searchParams: Promise<{ view?: string | string[] }> };

export default function MyListPage({ searchParams }: Props) {
  return (
    <PageMotion>
    <div className="v-page v-page-rows">
      <Suspense fallback={<SkeletonOut><PageHeader title="My List" /><div className="v-page-pad"><GridSkeleton count={12} /></div></SkeletonOut>}>
        <Reveal><Items searchParams={searchParams} /></Reveal>
      </Suspense>
    </div>
    </PageMotion>
  );
}

async function Items({ searchParams }: Props) {
  const sp = await searchParams;
  const [userId, view] = await Promise.all([currentUserId(), resolveView("my-list", Array.isArray(sp.view) ? sp.view[0] : sp.view, "grid")]);
  const items = userId ? await listBookmarks(userId) : [];
  const header = (
    <PageHeader
      title="My List"
      subtitle={`${items.length} ${items.length === 1 ? "title" : "titles"}`}
      controls={
        <>
          <CardSizeSlider />
          <ViewToggle cookie={viewCookie("my-list")} current={view} rowsHref="/my-list?view=rows" gridHref="/my-list?view=grid" />
        </>
      }
    />
  );
  if (!items.length) {
    return (
      <>
        {header}
        <div className="v-page-pad">
          <div className="v-panel v-empty-box">
            <h2>Your list is empty</h2>
            <p className="v-muted">Use the bookmark button on any movie or show to save it here.</p>
            <Link href="/dashboard" className="v-btn v-btn-primary">Browse the library</Link>
          </div>
        </div>
      </>
    );
  }
  if (view === "rows") {
    return (
      <>
        {header}
        <HubRow title="Movies" subtitle="Saved for later" items={items.filter((i) => i.kind === "movie")} />
        <HubRow title="TV Shows" subtitle="Saved for later" items={items.filter((i) => i.kind === "show")} />
      </>
    );
  }
  return (
    <>
      {header}
      <ul className="v-grid v-page-pad">
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <MediaCard item={item} badge />
          </li>
        ))}
      </ul>
    </>
  );
}
