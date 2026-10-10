import { Suspense } from "react";
import { AdminGuard } from "./_components/guard";
import { AdminNav } from "./_components/admin-nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <AdminGuard>
        <div className="md:flex md:min-h-dvh">
          <AdminNav />
          <main className="admin-main min-w-0 flex-1">{children}</main>
        </div>
      </AdminGuard>
    </Suspense>
  );
}
