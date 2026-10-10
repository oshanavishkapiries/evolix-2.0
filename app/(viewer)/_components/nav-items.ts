export const NAV_ITEMS = [
  { key: "dashboard", href: "/dashboard", label: "Home" },
  { key: "movies", href: "/movies", label: "Movies" },
  { key: "tv", href: "/tv", label: "TV Shows" },
  { key: "my-list", href: "/my-list", label: "My List" },
  { key: "search", href: "/search", label: "Search" },
] as const;
export type NavKey = (typeof NAV_ITEMS)[number]["key"] | "watch" | "account";

/** Sidebar shows browse destinations only; search lives in the top bar (and the phone tab bar). */
export const SIDEBAR_ITEMS = NAV_ITEMS.filter((n) => n.key !== "search");
