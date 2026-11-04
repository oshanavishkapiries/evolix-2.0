"use client";

import { usePathname } from "next/navigation";
import { isSettingsPath } from "./settings-tabs";

/** Admin shell. Full-bleed routes (the support inbox) opt in by path instead of relying on CSS `:has()`. */
export function AdminFrame({ className, nav, children }: { className: string; nav: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const fill = pathname.startsWith("/admin/support");
  const section = isSettingsPath(pathname) ? "settings" : undefined;
  return (
    <div className={`adm ${className}`} data-fill={fill ? "true" : undefined}>
      {nav}
      <main className="admin-main adm-main" data-fill={fill ? "true" : undefined} data-section={section}>{children}</main>
    </div>
  );
}
