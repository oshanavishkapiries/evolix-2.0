import { Suspense } from "react";
import { AdminOverview } from "./_components/admin-overview";
import { PageHeader } from "./_components/page-header";
import Link from "next/link";

export default function AdminPage() {
  return (
    <>
      <PageHeader
        title="Overview"
        actions={
          <>
            <Link
              href="/admin/movies/new"
              className="btn-secondary rounded-md border px-3 py-2 text-sm no-underline"
            >
              New movie
            </Link>
            <Link
              href="/admin/shows/new"
              className="btn-secondary rounded-md border px-3 py-2 text-sm no-underline"
            >
              New show
            </Link>
          </>
        }
      />
      <Suspense
        fallback={<div className="skeleton mt-4 h-32" aria-busy="true" />}
      >
        <AdminOverview />
      </Suspense>
    </>
  );
}
