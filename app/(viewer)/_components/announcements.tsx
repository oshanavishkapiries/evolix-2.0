"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { InboxItem } from "@/lib/announcements";
import { fetchWithRefresh } from "@/lib/client/api";
import { BellIcon, CloseIcon } from "./icons";

const POLL_MS = 60_000;

type Inbox = {
  items: InboxItem[];
  unread: number;
  read: (id: string) => void;
  readAll: () => void;
};
const Ctx = createContext<Inbox>({ items: [], unread: 0, read: () => {}, readAll: () => {} });

const post = (body: unknown) =>
  fetchWithRefresh("/api/me/announcements/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);

/** One inbox for the bell and the banner: loads on mount, refreshes on focus and every minute. Reads are optimistic. */
export function AnnouncementsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ items: InboxItem[]; unread: number }>({ items: [], unread: 0 });
  const busy = useRef(0);

  const load = useCallback(async () => {
    if (busy.current) return; // a local change is in flight; its refresh will follow
    try {
      const res = await fetchWithRefresh("/api/me/announcements");
      if (res.ok) setState(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    // Initial load plus polling; the setState happens after the fetch resolves, not synchronously.
    const first = setTimeout(load, 0);
    const timer = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const mutate = useCallback(
    async (body: { id: string } | { all: true }) => {
      setState((s) => {
        const items = s.items.map((i) => ("all" in body || i.id === body.id ? { ...i, read: true } : i));
        return { items, unread: items.filter((i) => !i.read).length };
      });
      busy.current++;
      await post(body);
      busy.current--;
      load();
    },
    [load],
  );

  const value = useMemo<Inbox>(
    () => ({ ...state, read: (id) => void mutate({ id }), readAll: () => void mutate({ all: true }) }),
    [state, mutate],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const useInbox = () => useContext(Ctx);

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
}

/** Opens an announcement's link: pages of this app stay in the app, https links open in a new tab. */
function useOpenLink() {
  const router = useRouter();
  return (url: string) => (url.startsWith("/") ? router.push(url) : window.open(url, "_blank", "noopener,noreferrer"));
}

export function NotificationBell() {
  const { items, unread, read, readAll } = useInbox();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const openLink = useOpenLink();

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

  return (
    <div className="v-menu" ref={root}>
      <button type="button" className="v-top-bell" aria-haspopup="dialog" aria-expanded={open} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} onClick={() => setOpen((o) => !o)}>
        <BellIcon size={20} />
        {unread > 0 && <span className="v-badge" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <section className="v-notify" role="dialog" aria-label="Notifications">
          <header>
            <h2>Notifications</h2>
            <button type="button" className="v-notify-all" disabled={!unread} onClick={readAll}>Mark all as read</button>
          </header>
          {items.length === 0 ? (
            <p className="v-notify-empty">You’re all caught up.</p>
          ) : (
            <ul>
              {items.map((i) => (
                <li key={i.id} data-unread={!i.read || undefined}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!i.read) read(i.id);
                      if (i.linkUrl) {
                        setOpen(false);
                        openLink(i.linkUrl);
                      }
                    }}
                  >
                    {i.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- admin-supplied address, any host
                      <img className="v-notify-img" src={i.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.hidden = true)} />
                    )}
                    <span className="v-notify-title">
                      {!i.read && <span className="v-notify-dot" aria-label="Unread" />}
                      {i.title}
                    </span>
                    {i.body && <span className="v-notify-body">{i.body}</span>}
                    <span className="v-notify-meta">{ago(i.publishedAt)}{i.linkUrl ? " · Open" : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** Priority announcements stay on screen, one at a time, until read; closing counts as reading. */
export function AnnouncementBanner() {
  const { items, read } = useInbox();
  const openLink = useOpenLink();
  const next = items.find((i) => i.priority === "banner" && !i.read);
  if (!next) return null;
  return (
    <div className="v-announce" role="status">
      {next.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- admin-supplied address, any host
        <img className="v-announce-img" src={next.imageUrl} alt="" decoding="async" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.hidden = true)} />
      )}
      <div className="v-announce-text">
        <strong>{next.title}</strong>
        {next.body && <span>{next.body}</span>}
      </div>
      {next.linkUrl && (
        <button type="button" className="v-btn v-btn-sm v-btn-primary" onClick={() => { read(next.id); openLink(next.linkUrl!); }}>
          Open
        </button>
      )}
      <button type="button" className="v-announce-x" aria-label="Dismiss" onClick={() => read(next.id)}>
        <CloseIcon size={18} />
      </button>
    </div>
  );
}
