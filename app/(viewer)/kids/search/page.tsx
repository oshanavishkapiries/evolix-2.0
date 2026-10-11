import type { Metadata } from "next";
import { SearchView } from "../../_components/search-view";

export const metadata: Metadata = { title: "Kids Search" };

export default function KidsSearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SearchView searchParams={searchParams} scope="kids" />;
}
