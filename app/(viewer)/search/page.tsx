import type { Metadata } from "next";
import { SearchView } from "../_components/search-view";

export const metadata: Metadata = { title: "Browse" };

export default function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SearchView searchParams={searchParams} />;
}
