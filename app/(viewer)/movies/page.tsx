import type { Metadata } from "next";
import { BrowsePage } from "../_components/browse-page";

export const metadata: Metadata = { title: "Movies" };

export default function MoviesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <BrowsePage kind="movie" basePath="/movies" heading="Movies" searchParams={searchParams} />;
}
