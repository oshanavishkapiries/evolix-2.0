"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BellIcon, FilmIcon, FlagIcon, MenuIcon, TvIcon } from "@/app/(viewer)/_components/icons";
import { ActivityIcon, CdnIcon, DashboardIcon, PipelineIcon, SettingsIcon, UsersIcon } from "./admin-icons";

const LINKS = [
  { href: "/admin", label: "Overview", icon: DashboardIcon, match: (p: string) => p === "/admin" },
  { href: "/admin/movies", label: "Movies", icon: FilmIcon, match: (p: string) => p.startsWith("/admin/movies") },
  { href: "/admin/shows", label: "TV shows", icon: TvIcon, match: (p: string) => p.startsWith("/admin/shows") },
  { href: "/admin/evo", label: "Evo pipeline", icon: PipelineIcon, match: (p: string) => p.startsWith("/admin/evo") },
  { href: "/admin/cdn", label: "CDN files", icon: CdnIcon, match: (p: string) => p.startsWith("/admin/cdn") },
  { href: "/admin/activity", label: "Activity", icon: ActivityIcon, match: (p: string) => p.startsWith("/admin/activity") },
  { href: "/admin/users", label: "Users", icon: UsersIcon, match: (p: string) => p.startsWith("/admin/users") },
  { href: "/admin/settings", label: "Settings", icon: SettingsIcon, match: (p: string) => p === "/admin/settings" },
  { href: "/admin/reports", label: "Reports", icon: FlagIcon, match: (p: string) => p.startsWith("/admin/reports") },
  { href: "/admin/announcements", label: "Announcements", icon: BellIcon, match: (p: string) => p.startsWith("/admin/announcements") },
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
