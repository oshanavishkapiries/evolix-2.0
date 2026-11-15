"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import { useVisiblePoll } from "./poll";
import type { InboxSummary } from "@/app/api/me/inbox/summary";
import type { SupportNotification } from "@/lib/support/types";

const Unread = createContext<SupportNotification & { refresh: () => Promise<void>; markAllRead: () => Promise<void> }>({ count: 0, latest: null, refresh: async () => {}, markAllRead: async () => {} });
export const useSupportNotifications = () => useContext(Unread);
export const supportUpdated = () => window.dispatchEvent(new Event("support-updated"));

export type ViewerInboxSeed = { unreadSupport: SupportNotification; announcements: InboxSummary };
const InboxSummaryContext = createContext<{ summary: InboxSummary; refresh: () => Promise<void>; seed: (data: ViewerInboxSeed) => void } | null>(null);
export const useInboxSummary = () => useContext(InboxSummaryContext);

export function SupportUnreadProvider({ admin = false, initial, children }: { admin?: boolean; initial?: ViewerInboxSeed; children: React.ReactNode }) {
  const [state, setState] = useState<SupportNotification>(initial?.unreadSupport ?? { count: 0, latest: null });
  const [summary, setSummary] = useState<InboxSummary>(initial?.announcements ?? { items: [], unread: 0 });
  const seed = useCallback((data: ViewerInboxSeed) => { setState(data.unreadSupport); setSummary(data.announcements); }, []);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const res = await fetchWithRefresh(admin ? "/api/admin/support/unread" : "/api/me/inbox", { cache: "no-store" });
      if (res.ok) {
        const body = await res.json();
        if (id === requestId.current) {
          setState(admin ? { count: body.count ?? 0, latest: body.latest ?? null } : body.unreadSupport);
          if (!admin) setSummary(body.announcements);
        }
      }
    } catch { /* A badge must not interrupt browsing when the connection drops. */ }
  }, [admin]);
  async function markAllRead() {
    if (!state.latest || admin) return;
    try {
      const res = await fetchWithRefresh("/api/me/support/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ through: state.latest.id }) });
      if (res.ok) await refresh();
    } catch { /* Preserve the unread indication if marking it read fails. */ }
  }
  useVisiblePoll(refresh, 45000, !initial);
  useEffect(() => {
    const update = () => { if (document.visibilityState !== "hidden") void refresh(); };
    window.addEventListener("support-updated", update);
    return () => window.removeEventListener("support-updated", update);
  }, [refresh]);
  return <InboxSummaryContext.Provider value={{ summary, refresh, seed }}><Unread.Provider value={{ ...state, refresh, markAllRead }}>{children}</Unread.Provider></InboxSummaryContext.Provider>;
}

export function SupportBadge() {
  const { count } = useContext(Unread);
  return count > 0 ? <span className="support-badge" aria-label={`${count} unread support messages`}>{count > 99 ? "99+" : count}</span> : null;
}
