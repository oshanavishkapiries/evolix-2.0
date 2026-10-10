"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fetchWithRefresh, navigate, postJson } from "@/lib/client/api";
import { SEARCH_MIN_CHARS, useDebouncedValue } from "@/lib/client/use-debounced";
import { FilmIcon, HomeIcon, ListIcon, MenuIcon, SearchIcon, TvIcon, UserIcon } from "./icons";
import { activeNavKey, SIDEBAR_ITEMS } from "./nav-items";
import { PREF_SIDEBAR, savePref } from "./prefs";

const ICONS = { dashboard: HomeIcon, movies: FilmIcon, tv: TvIcon, "my-list": ListIcon };
const DESKTOP = "(min-width: 80rem)";

function NavSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [debounced, flush] = useDebouncedValue(value.trim());
  const lastSent = useRef("");

  useEffect(() => {
    if (debounced.length < SEARCH_MIN_CHARS || debounced === lastSent.current) return;
    lastSent.current = debounced;
    router.push(`/search?q=${encodeURIComponent(debounced)}`);
  }, [debounced, router]);

  return (
    <form
      role="search"
      className="v-top-search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (q.length < SEARCH_MIN_CHARS) return;
        flush(q);
        lastSent.current = q;
        router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
    >
      <SearchIcon size={16} />
      <label className="v-sr" htmlFor="nav-search">Search titles</label>
      <input
        id="nav-search"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search movies and shows"
        autoComplete="off"
        enterKeyHint="search"
      />
    </form>
  );
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<{ email: string; isAdmin: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function toggle() {
    setOpen((o) => !o);
    if (me) return;
    try {
      const res = await fetchWithRefresh("/api/auth/me");
      if (res.ok) {
        const body = await res.json();
        setMe({ email: body.user?.email ?? "", isAdmin: body.isAdmin === true });
      }
    } catch {}
  }

  async function logout() {
    await postJson("/api/auth/logout");
    navigate("/login");
  }

  const initial = me?.email ? me.email[0].toUpperCase() : null;
  return (
    <div className="v-menu" ref={root}>
      <button type="button" className="v-avatar" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={toggle}>
        {initial ?? <UserIcon size={16} />}
      </button>
      {open && (
        <div className="v-menu-panel" role="menu">
          {me?.email && <p className="v-menu-email">{me.email}</p>}
          <Link href="/account" role="menuitem" onClick={() => setOpen(false)}>Account</Link>
          {me?.isAdmin && <a href="/admin" role="menuitem">Admin</a>}
          <button type="button" role="menuitem" onClick={logout}>Log out</button>
        </div>
      )}
    </div>
  );
}

/** Top bar + left sidebar. Desktop: hamburger toggles expanded/rail (remembered). Tablet: opens a drawer. */
export function AppChrome() {
  const activeKey = activeNavKey(usePathname());
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  function toggle() {
    if (!window.matchMedia(DESKTOP).matches) return setDrawer((d) => !d);
    const d = document.documentElement;
    const next = d.dataset.vSidebar === "rail" ? "expanded" : "rail";
    d.dataset.vSidebar = next;
    savePref(PREF_SIDEBAR, next);
  }

  return (
    <>
      <header className="v-top">
        <button type="button" className="v-top-menu" aria-label="Toggle navigation" aria-expanded={drawer} onClick={toggle}>
          <MenuIcon />
        </button>
        <Link href="/dashboard" className="v-logo" aria-label="Evolix home">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
          <img src="/svg/evolix.svg" alt="Evolix" width={100} height={29} />
        </Link>
        <NavSearch />
        <div className="v-top-end">
          <Link href="/search" className="v-top-icon" aria-label="Search">
            <SearchIcon size={20} />
          </Link>
          <UserMenu />
        </div>
      </header>
      <nav className="v-side" aria-label="Main" data-drawer={drawer}>
        <ul>
          {SIDEBAR_ITEMS.map((n) => {
            const Icon = ICONS[n.key];
            return (
              <li key={n.key}>
                <Link href={n.href} data-key={n.key} aria-current={n.key === activeKey ? "page" : undefined} title={n.label} onClick={() => setDrawer(false)}>
                  <Icon size={22} />
                  <span>{n.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="v-scrim" data-open={drawer} onClick={() => setDrawer(false)} aria-hidden="true" />
    </>
  );
}
