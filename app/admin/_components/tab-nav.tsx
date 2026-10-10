"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type Tab = { href: string; label: string; /** Active only on this exact path (default: also on sub-paths). */ exact?: boolean };

/** Link tabs; the bar scrolls horizontally inside itself on narrow screens. */
export function TabNav({ label, tabs }: { label: string; tabs: Tab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="tabs">
      <ul>
        {tabs.map((t) => {
          const active = pathname === t.href || (!t.exact && pathname.startsWith(`${t.href}/`));
          return (
            <li key={t.href}>
              <Link href={t.href} className="tab" aria-current={active ? "page" : undefined}>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
