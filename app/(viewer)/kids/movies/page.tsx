import type { Metadata } from "next";
import { BrowsePage } from "../../_components/browse-page";

export const metadata: Metadata = { title: "Kids Movies" };

export default function KidsMoviesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <BrowsePage kind="movie" basePath="/kids/movies" heading="Kids Movies" searchParams={searchParams} scope="kids" />;
}
