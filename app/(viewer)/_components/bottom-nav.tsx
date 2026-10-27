"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { FilmIcon, HomeIcon, ListIcon, MenuIcon, SearchIcon, TvIcon, UserIcon } from "./icons";
import { activeNavKey, NAV_ITEMS } from "./nav-items";

const ICONS = { dashboard: HomeIcon, movies: FilmIcon, tv: TvIcon, "my-list": ListIcon, search: SearchIcon };
const MAX_TABS = 4;

/** Everything past the tab limit, plus Account, lives in the sheet behind the last tab. */
const SHEET_EXTRA = [{ key: "account", href: "/account", label: "Account" }] as const;

/** Phone tab bar: at most four tabs; with more destinations the last tab opens a bottom sheet (tablet and desktop use the sidebar). */
export function BottomNav() {
  const pathname = usePathname();
  const active = activeNavKey(pathname);
  const sheet = useRef<HTMLDialogElement>(null);

  // The sheet always exists (Account is in it), so the bar shows three destinations plus "More".
  const tabs = NAV_ITEMS.slice(0, MAX_TABS - 1);
  const rest = NAV_ITEMS.slice(MAX_TABS - 1);
  const moreActive = rest.some((n) => n.key === active) || active === "account";

  useEffect(() => {
    if (sheet.current?.open) sheet.current.close();
  }, [pathname]);

  return (
    <>
      <nav className="v-bottom" aria-label="Main">
        {tabs.map((n) => {
          const Icon = ICONS[n.key];
          return (
            <Link key={n.key} href={n.href} data-key={n.key} aria-current={n.key === active ? "page" : undefined}>
              <Icon size={20} />
              <span>{n.label}</span>
            </Link>
          );
        })}
        <button type="button" data-key="more" className="v-bottom-more" aria-haspopup="dialog" aria-current={moreActive ? "page" : undefined} onClick={() => sheet.current?.showModal()}>
          <MenuIcon size={20} />
          <span>More</span>
        </button>
      </nav>
      <dialog
        ref={sheet}
        className="v-sheet"
        aria-label="More navigation"
        onClick={(e) => {
          if (e.target === sheet.current) sheet.current?.close();
        }}
      >
        <div className="v-sheet-grip" aria-hidden="true" />
        <ul>
          {rest.map((n) => {
            const Icon = ICONS[n.key];
            return (
              <li key={n.key}>
                <Link href={n.href} aria-current={n.key === active ? "page" : undefined}>
                  <Icon size={20} />
                  <span>{n.label}</span>
                </Link>
              </li>
            );
          })}
          {SHEET_EXTRA.map((n) => (
            <li key={n.key}>
              <Link href={n.href} aria-current={n.key === active ? "page" : undefined}>
                <UserIcon size={20} />
                <span>{n.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
