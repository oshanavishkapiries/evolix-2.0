import { Suspense } from "react";
import { AdminGuard } from "./_components/guard";
import { AdminNav } from "./_components/admin-nav";
import { ConfirmProvider } from "./_components/confirm-dialog";
import { ToastProvider } from "./_components/toast";
import { ServerInfo } from "./_components/server-info";
import { Noto_Sans } from "next/font/google";
import "./admin.css";

const font = Noto_Sans({ subsets: ["latin"], weight: ["400", "500", "700"], display: "swap" });

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <AdminGuard>
        <ToastProvider>
          <ConfirmProvider>
            <div className={`adm ${font.className}`}>
              <AdminNav
                footer={
                  <Suspense fallback={null}>
                    <ServerInfo />
                  </Suspense>
                }
              />
              <main className="admin-main adm-main">{children}</main>
            </div>
          </ConfirmProvider>
        </ToastProvider>
      </AdminGuard>
    </Suspense>
  );
}
