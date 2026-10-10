"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/admin", label: "Overview", match: (p: string) => p === "/admin" },
  {
    href: "/admin/movies",
    label: "Movies",
    match: (p: string) => p.startsWith("/admin/movies") && p !== "/admin/movies/new",
  },
  {
    href: "/admin/shows",
    label: "TV shows",
    match: (p: string) => p.startsWith("/admin/shows") && p !== "/admin/shows/new",
  },
  { href: "/admin/movies/new", label: "New movie", match: (p: string) => p === "/admin/movies/new" },
  { href: "/admin/shows/new", label: "New show", match: (p: string) => p === "/admin/shows/new" },
  { href: "/admin/import-export", label: "Import / Export", match: (p: string) => p === "/admin/import-export" },
];

const linkClass = (active: boolean) =>
  `block rounded-md px-3 py-2 text-sm font-medium no-underline hover:no-underline ${
    active
      ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
  }`;

/** Sidebar on desktop (sticky, full height); collapsible top bar below 768px. */
export function AdminNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <aside className="border-b border-gray-200 bg-white md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between px-4 py-3 md:block md:px-5 md:py-5">
        <Link href="/admin" className="text-lg font-semibold text-gray-900 no-underline hover:no-underline dark:text-gray-100">
          Evolix Admin
        </Link>
        <button
          type="button"
          className="btn-secondary md:hidden"
          aria-expanded={open}
          aria-controls="admin-menu"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close menu" : "Menu"}
        </button>
      </div>
      <nav id="admin-menu" aria-label="Admin" className={`${open ? "block" : "hidden"} px-3 pb-4 md:block`}>
        <ul className="space-y-1">
          {LINKS.map((l) => {
            const active = l.match(pathname);
            return (
              <li key={l.href}>
                <Link href={l.href} className={linkClass(active)} aria-current={active ? "page" : undefined} onClick={close}>
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <hr className="my-3 border-gray-200 dark:border-gray-800" />
        <a href="/dashboard" className={linkClass(false)}>
          Back to dashboard
        </a>
      </nav>
    </aside>
  );
}
