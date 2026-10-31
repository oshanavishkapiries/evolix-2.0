"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import { useVisiblePoll } from "./poll";

const Unread = createContext(0);
export const supportUpdated = () => window.dispatchEvent(new Event("support-updated"));

export function SupportUnreadProvider({ admin = false, children }: { admin?: boolean; children: React.ReactNode }) {
  const [count, setCount] = useState(0);
  async function refresh() {
    try {
      const res = await fetchWithRefresh(`/api/${admin ? "admin" : "me"}/support/unread`, { cache: "no-store" });
      if (res.ok) setCount((await res.json()).count ?? 0);
    } catch { /* A badge must not interrupt browsing when the connection drops. */ }
  }
  useVisiblePoll(refresh, 45000);
  useEffect(() => {
    const update = () => { if (document.visibilityState !== "hidden") void refresh(); };
    window.addEventListener("support-updated", update);
    return () => window.removeEventListener("support-updated", update);
    // The provider's role is fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Unread.Provider value={count}>{children}</Unread.Provider>;
}

export function SupportBadge() {
  const count = useContext(Unread);
  return count > 0 ? <span className="support-badge" aria-label={`${count} unread support messages`}>{count > 99 ? "99+" : count}</span> : null;
}
