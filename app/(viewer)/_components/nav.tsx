"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fetchWithRefresh, navigate, postJson } from "@/lib/client/api";
import { SEARCH_MIN_CHARS, useDebouncedValue } from "@/lib/client/use-debounced";

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
      className="v-nav-search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (q.length < SEARCH_MIN_CHARS) return;
        flush(q);
        lastSent.current = q;
        router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
    >
      <label className="v-sr" htmlFor="nav-search">Search titles</label>
      <input
        id="nav-search"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search"
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

  return (
    <div className="v-menu" ref={root}>
      <button type="button" className="v-icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={toggle}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
        </svg>
      </button>
      {open && (
        <div className="v-menu-panel" role="menu">
          {me?.email && <p className="v-menu-email">{me.email}</p>}
          <a href="/account" role="menuitem">Account</a>
          {me?.isAdmin && <a href="/admin" role="menuitem">Admin</a>}
          <button type="button" role="menuitem" onClick={logout}>Log out</button>
        </div>
      )}
    </div>
  );
}

export function ViewerNav() {
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="v-nav" data-solid={solid}>
      <Link href="/dashboard" className="v-wordmark" aria-label="Evolix home">EVOLIX</Link>
      <nav aria-label="Main" className="v-nav-links">
        <Link href="/dashboard">Home</Link>
        <Link href="/search">Browse</Link>
      </nav>
      <div className="v-nav-end">
        <NavSearch />
        <UserMenu />
      </div>
    </header>
  );
}
