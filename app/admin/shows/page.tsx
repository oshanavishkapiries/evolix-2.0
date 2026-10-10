import Link from "next/link";
import { TitleList } from "../_components/admin-lists";
import { PageHeader } from "../_components/page-header";

export default function ShowsPage() {
  return (
    <>
      <PageHeader
        title="TV shows"
        actions={
          <Link href="/admin/shows/new" className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white no-underline hover:bg-indigo-700 hover:no-underline">
            New show
          </Link>
        }
      />
      <TitleList kind="shows" />
    </>
  );
}
