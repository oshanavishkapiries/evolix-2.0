"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FilmIcon, FlagIcon, HomeIcon, MenuIcon, PlayIcon, TvIcon } from "@/app/(viewer)/_components/icons";

const PlusIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
);

const LINKS = [
  { href: "/admin", label: "Overview", icon: HomeIcon, match: (p: string) => p === "/admin" },
  { href: "/admin/movies", label: "Movies", icon: FilmIcon, match: (p: string) => p.startsWith("/admin/movies") && p !== "/admin/movies/new" },
  { href: "/admin/shows", label: "TV shows", icon: TvIcon, match: (p: string) => p.startsWith("/admin/shows") && p !== "/admin/shows/new" },
  { href: "/admin/evo", label: "Evo pipeline", icon: PlayIcon, match: (p: string) => p.startsWith("/admin/evo") },
  { href: "/admin/activity", label: "Activity", icon: PlayIcon, match: (p: string) => p.startsWith("/admin/activity") },
  { href: "/admin/users", label: "Users", icon: HomeIcon, match: (p: string) => p.startsWith("/admin/users") },
  { href: "/admin/settings", label: "Settings", icon: MenuIcon, match: (p: string) => p === "/admin/settings" },
  { href: "/admin/reports", label: "Reports", icon: FlagIcon, match: (p: string) => p.startsWith("/admin/reports") },
  { href: "/admin/movies/new", label: "New movie", icon: PlusIcon, match: (p: string) => p === "/admin/movies/new" },
  { href: "/admin/shows/new", label: "New show", icon: PlusIcon, match: (p: string) => p === "/admin/shows/new" },
];

/** Sidebar on desktop (sticky, full height); collapsible top bar below 768px. */
export function AdminNav({ footer }: { footer?: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <aside className="adm-side" data-open={open}>
      <div className="adm-side-head">
        <Link href="/admin" className="adm-brand">
          evolix
        </Link>
        <button type="button" className="adm-menu-btn" aria-expanded={open} aria-controls="admin-menu" aria-label="Toggle menu" onClick={() => setOpen((o) => !o)}>
          <MenuIcon />
        </button>
      </div>
      <nav id="admin-menu" aria-label="Admin" className="adm-nav">
        <ul>
          {LINKS.map((l) => {
            const active = l.match(pathname);
            const Icon = l.icon;
            return (
              <li key={l.href}>
                <Link href={l.href} aria-current={active ? "page" : undefined} onClick={close}>
                  <Icon size={20} />
                  <span>{l.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <hr />
        <a href="/dashboard" className="adm-back">
          <span>← Back to site</span>
        </a>
      </nav>
      {footer}
    </aside>
  );
}
