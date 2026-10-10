import { AdminOverview } from "./_components/admin-lists";
import { PageHeader } from "./_components/page-header";
import Link from "next/link";

export default function AdminPage() {
  return (
    <>
      <PageHeader
        title="Overview"
        actions={
          <>
            <Link href="/admin/movies/new" className="btn-secondary rounded-md border px-3 py-2 text-sm no-underline">
              New movie
            </Link>
            <Link href="/admin/shows/new" className="btn-secondary rounded-md border px-3 py-2 text-sm no-underline">
              New show
            </Link>
          </>
        }
      />
      <AdminOverview />
    </>
  );
}
