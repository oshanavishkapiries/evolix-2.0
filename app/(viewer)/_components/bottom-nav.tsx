import Link from "next/link";
import { FilmIcon, HomeIcon, SearchIcon, TvIcon } from "./icons";
import { NAV_ITEMS } from "./nav-items";

const ICONS = { dashboard: HomeIcon, movies: FilmIcon, tv: TvIcon, search: SearchIcon };

/** Mobile/tablet tab bar (the top links are hidden below the lg breakpoint). */
export function BottomNav() {
  return (
    <nav className="v-bottom" aria-label="Main">
      {NAV_ITEMS.map((n) => {
        const Icon = ICONS[n.key];
        return (
          <Link key={n.key} href={n.href} data-key={n.key}>
            <Icon size={20} />
            <span>{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
