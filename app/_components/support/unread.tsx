"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import { useVisiblePoll } from "./poll";
import type { SupportNotification } from "@/lib/support/types";

const Unread = createContext<SupportNotification & { refresh: () => Promise<void>; markAllRead: () => Promise<void> }>({ count: 0, latest: null, refresh: async () => {}, markAllRead: async () => {} });
export const useSupportNotifications = () => useContext(Unread);
export const supportUpdated = () => window.dispatchEvent(new Event("support-updated"));

export function SupportUnreadProvider({ admin = false, children }: { admin?: boolean; children: React.ReactNode }) {
  const [state, setState] = useState<SupportNotification>({ count: 0, latest: null });
  const requestId = useRef(0);
  async function refresh() {
    const id = ++requestId.current;
    try {
      const res = await fetchWithRefresh(`/api/${admin ? "admin" : "me"}/support/unread`, { cache: "no-store" });
      if (res.ok) {
        const body = await res.json();
        if (id === requestId.current) setState({ count: body.count ?? 0, latest: body.latest ?? null });
      }
    } catch { /* A badge must not interrupt browsing when the connection drops. */ }
  }
  async function markAllRead() {
    if (!state.latest || admin) return;
    try {
      const res = await fetchWithRefresh("/api/me/support/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ through: state.latest.id }) });
      if (res.ok) await refresh();
    } catch { /* Preserve the unread indication if marking it read fails. */ }
  }
  useVisiblePoll(refresh, 45000);
  useEffect(() => {
    const update = () => { if (document.visibilityState !== "hidden") void refresh(); };
    window.addEventListener("support-updated", update);
    return () => window.removeEventListener("support-updated", update);
    // The provider's role is fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Unread.Provider value={{ ...state, refresh, markAllRead }}>{children}</Unread.Provider>;
}

export function SupportBadge() {
  const { count } = useContext(Unread);
  return count > 0 ? <span className="support-badge" aria-label={`${count} unread support messages`}>{count > 99 ? "99+" : count}</span> : null;
}
