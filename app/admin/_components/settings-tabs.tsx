"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sections that live under Settings. */
const SETTINGS_TABS = [
  { href: "/admin/settings", label: "General", exact: true },
  { href: "/admin/config", label: "Configuration", exact: false },
  { href: "/admin/errors", label: "Errors", exact: false },
  { href: "/admin/reports", label: "Reports", exact: false },
];

export const isSettingsPath = (p: string) => SETTINGS_TABS.some((t) => p === t.href || p.startsWith(`${t.href}/`));

/** Settings layout: a section list on the left, the selected topic on the right (stacks on narrow screens). */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="set-shell">
      <nav aria-label="Settings sections" className="set-side">
        <p className="set-side-title">Settings</p>
        <ul>
          {SETTINGS_TABS.map((t) => {
            const active = pathname === t.href || (!t.exact && pathname.startsWith(`${t.href}/`));
            return (
              <li key={t.href}>
                <Link href={t.href} aria-current={active ? "page" : undefined}>
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="set-body">{children}</div>
    </div>
  );
}
