import { SupportUnreadProvider } from "@/app/_components/support/unread";
import "@/app/_components/support/support.css";
import { Suspense } from "react";
import { AdminGuard } from "./_components/guard";
import { AdminFrame } from "./_components/admin-frame";
import { AdminNav } from "./_components/admin-nav";
import { ConfirmProvider } from "./_components/confirm-dialog";
import { ToastProvider } from "./_components/toast";
import { ServerInfo } from "./_components/server-info";
import { font } from "@/app/fonts";
import "./admin.css";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <AdminGuard>
        <ToastProvider>
          <ConfirmProvider>
            <SupportUnreadProvider admin>
              <AdminFrame
                className={font.className}
                nav={
                  <AdminNav
                    footer={
                      <Suspense fallback={null}>
                        <ServerInfo />
                      </Suspense>
                    }
                  />
                }
              >
                {children}
              </AdminFrame>
            </SupportUnreadProvider>
          </ConfirmProvider>
        </ToastProvider>
      </AdminGuard>
    </Suspense>
  );
}
