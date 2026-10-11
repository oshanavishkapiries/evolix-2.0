import type { Metadata } from "next";
import { BrowsePage } from "../../_components/browse-page";

export const metadata: Metadata = { title: "Kids TV Shows" };

export default function KidsTvPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <BrowsePage kind="show" basePath="/kids/tv" heading="Kids TV Shows" searchParams={searchParams} scope="kids" />;
}
