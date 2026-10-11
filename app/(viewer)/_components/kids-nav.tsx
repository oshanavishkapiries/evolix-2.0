import Link from "next/link";

const TABS = [
  { key: "home", href: "/kids", label: "Kids Home" },
  { key: "movies", href: "/kids/movies", label: "Movies" },
  { key: "tv", href: "/kids/tv", label: "TV Shows" },
  { key: "search", href: "/kids/search", label: "Search" },
] as const;
export type KidsTab = (typeof TABS)[number]["key"];

/** Sub-navigation of the Kids section; every link stays inside it. */
export function KidsNav({ current }: { current: KidsTab }) {
  return (
    <nav className="v-filters v-kids-nav" aria-label="Kids">
      <span className="v-seg" role="group">
        {TABS.map((t) => (
          <Link key={t.key} href={t.href} aria-current={t.key === current}>
            {t.label}
          </Link>
        ))}
      </span>
    </nav>
  );
}
