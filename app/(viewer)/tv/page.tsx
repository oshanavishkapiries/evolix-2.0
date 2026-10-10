import type { Metadata } from "next";
import { BrowsePage } from "../_components/browse-page";

export const metadata: Metadata = { title: "TV Shows" };

export default function TvPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <BrowsePage kind="show" basePath="/tv" heading="TV Shows" searchParams={searchParams} />;
}
