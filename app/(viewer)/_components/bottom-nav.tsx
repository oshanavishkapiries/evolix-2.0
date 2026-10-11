"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FilmIcon, HomeIcon, KidsIcon, ListIcon, SearchIcon, TvIcon } from "./icons";
import { activeNavKey, NAV_ITEMS } from "./nav-items";

const ICONS = { dashboard: HomeIcon, movies: FilmIcon, tv: TvIcon, kids: KidsIcon, "my-list": ListIcon, search: SearchIcon };

/** Phone tab bar (tablet and desktop use the sidebar). */
export function BottomNav() {
  const active = activeNavKey(usePathname());
  return (
    <nav className="v-bottom" aria-label="Main">
      {NAV_ITEMS.map((n) => {
        const Icon = ICONS[n.key];
        return (
          <Link key={n.key} href={n.href} data-key={n.key} aria-current={n.key === active ? "page" : undefined}>
            <Icon size={20} />
            <span>{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
