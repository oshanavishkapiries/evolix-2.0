import Link from "next/link";
import { FilmIcon, HomeIcon, ListIcon, SearchIcon, TvIcon } from "./icons";
import { NAV_ITEMS } from "./nav-items";

const ICONS = { dashboard: HomeIcon, movies: FilmIcon, tv: TvIcon, "my-list": ListIcon, search: SearchIcon };

/** Phone tab bar (tablet and desktop use the sidebar). */
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
