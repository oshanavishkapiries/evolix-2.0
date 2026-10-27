import Link from "next/link";
import { Suspense } from "react";
import { TitleList } from "../_components/title-list";
import { PageHeader } from "../_components/page-header";

export default function ShowsPage() {
  return (
    <>
      <PageHeader
        title="TV shows"
        actions={
          <Link href="/admin/shows/new" className="btn-secondary rounded-md border px-3 py-2 text-sm no-underline">
            New show
          </Link>
        }
      />
      <Suspense fallback={<div className="skeleton mt-4 h-32" aria-busy="true" />}>
        <TitleList kind="shows" />
      </Suspense>
    </>
  );
}
