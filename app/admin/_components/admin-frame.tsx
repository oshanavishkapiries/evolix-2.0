"use client";

import { usePathname } from "next/navigation";

/** Admin shell. Full-bleed routes (the support inbox) opt in by path instead of relying on CSS `:has()`. */
export function AdminFrame({ className, nav, children }: { className: string; nav: React.ReactNode; children: React.ReactNode }) {
  const fill = (usePathname() ?? "").startsWith("/admin/support");
  return (
    <div className={`adm ${className}`} data-fill={fill ? "true" : undefined}>
      {nav}
      <main className="admin-main adm-main" data-fill={fill ? "true" : undefined}>{children}</main>
    </div>
  );
}
