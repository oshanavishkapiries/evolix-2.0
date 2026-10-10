import Link from "next/link";
import { Suspense } from "react";
import { AdminGuard } from "./_components/guard";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <AdminGuard>
        <header>
          <nav aria-label="Admin">
            <a href="/admin">Admin home</a> | <Link href="/admin/movies/new">Add movie</Link> |{" "}
            <Link href="/admin/shows/new">Add show</Link> | <a href="/dashboard">Dashboard</a>
          </nav>
        </header>
        <main>{children}</main>
      </AdminGuard>
    </Suspense>
  );
}
