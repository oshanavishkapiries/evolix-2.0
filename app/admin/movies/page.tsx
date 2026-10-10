import Link from "next/link";
import { TitleList } from "../_components/admin-lists";
import { PageHeader } from "../_components/page-header";

export default function MoviesPage() {
  return (
    <>
      <PageHeader
        title="Movies"
        actions={
          <Link href="/admin/movies/new" className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white no-underline hover:bg-indigo-700 hover:no-underline">
            New movie
          </Link>
        }
      />
      <TitleList kind="movies" />
    </>
  );
}
