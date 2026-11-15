import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeApproval, HomeBrowseLink, HomeContinue, HomeEmpty, HomeFeatured, HomeGenres, HomeLatest, HomeMyList } from "../_components/home-rows";
import { RowSkeleton } from "../_components/skeletons";
import { PageMotion } from "../_components/motion";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return (
    <PageMotion>
      <div className="v-page v-page-rows">
        <h1 className="v-sr">Home</h1>
        <Suspense fallback={null}><HomeApproval /></Suspense>
        <Suspense fallback={null}><HomeEmpty /></Suspense>
        <Suspense fallback={<RowSkeleton landscape />}><HomeFeatured /></Suspense>
        <Suspense fallback={<RowSkeleton landscape />}><HomeContinue /></Suspense>
        <Suspense fallback={<RowSkeleton />}><HomeMyList /></Suspense>
        <Suspense fallback={<RowSkeleton />}><HomeLatest kind="movie" /></Suspense>
        <Suspense fallback={<RowSkeleton />}><HomeLatest kind="show" /></Suspense>
        <Suspense fallback={<RowSkeleton />}><HomeGenres /></Suspense>
        <Suspense fallback={null}><HomeBrowseLink /></Suspense>
      </div>
    </PageMotion>
  );
}
