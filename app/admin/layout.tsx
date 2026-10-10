import Link from "next/link";
import { Suspense } from "react";
import { AdminGuard } from "./_components/guard";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <AdminGuard>
        <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <nav aria-label="Admin" className="mx-auto flex max-w-5xl flex-wrap gap-x-5 gap-y-1 px-4 py-3 text-sm font-medium sm:px-6">
            <a href="/admin">Admin home</a>
            <Link href="/admin/movies/new">Add movie</Link>
            <Link href="/admin/shows/new">Add show</Link>
            <a href="/dashboard">Dashboard</a>
          </nav>
        </header>
        <main className="page">{children}</main>
      </AdminGuard>
    </Suspense>
  );
}
