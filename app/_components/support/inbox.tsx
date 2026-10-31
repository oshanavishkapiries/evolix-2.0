"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import type { SupportInboxItem } from "@/lib/support/types";
import { TZ } from "@/lib/tz";
import { SupportChat } from "./chat";
import { useVisiblePoll } from "./poll";

export function SupportInbox({ initialUserId }: { initialUserId?: string }) {
  const [selected, setSelected] = useState<{ id: string; email?: string } | null>(initialUserId ? { id: initialUserId } : null);
  const [items, setItems] = useState<SupportInboxItem[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newChat, setNewChat] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [users, setUsers] = useState<{ id: string; email: string }[]>([]);
  const [directoryError, setDirectoryError] = useState("");
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const visibleLimit = useRef(30);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const params = new URLSearchParams({ q: search, filter });
      // Preserve loaded pages during refresh instead of silently hiding older conversations.
      let all: SupportInboxItem[] = [];
      let more = false;
      do {
        const res = await fetchWithRefresh(`/api/admin/support?${params}`, { cache: "no-store" });
        if (!res.ok) throw new Error("The support inbox couldn’t be loaded.");
        const body = await res.json();
        all = [...all, ...body.conversations]; more = body.hasMore;
        if (!more || !all.length) break;
        params.set("before", String(all[all.length - 1].latestId));
      } while (all.length < visibleLimit.current);
      if (id !== requestId.current) return;
      setItems([...new Map(all.map((item) => [item.id, item])).values()]);
      setHasMore(more); setError("");
    } catch (e) { if (id === requestId.current) setError(e instanceof Error ? e.message : "Please try again."); }
    finally { if (id === requestId.current) setLoading(false); }
  }, [search, filter]);
  useVisiblePoll(refresh, 10000);
  useEffect(() => {
    visibleLimit.current = 30;
    const timer = setTimeout(() => void refresh(), 300);
    return () => { clearTimeout(timer); requestId.current += 1; };
  }, [refresh]);

  useEffect(() => {
    if (!newChat || userSearch.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setDirectoryLoading(true); setDirectoryError("");
      try {
        const res = await fetchWithRefresh(`/api/admin/support?directory=1&q=${encodeURIComponent(userSearch.trim())}`, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error("User search is unavailable. Please try again.");
        const body = await res.json();
        if (!controller.signal.aborted) setUsers(body.users);
      } catch (e) { if (!controller.signal.aborted) setDirectoryError(e instanceof Error ? e.message : "Please try again."); }
      finally { if (!controller.signal.aborted) setDirectoryLoading(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [newChat, userSearch]);

  function select(user: { id: string; email?: string }) {
    setSelected(user); setNewChat(false);
    window.history.replaceState(null, "", `/admin/support?user=${user.id}`);
  }
  function back() { setSelected(null); window.history.replaceState(null, "", "/admin/support"); }

  return <div className="support-inbox" data-selected={Boolean(selected)}>
    <aside className="support-inbox-list" aria-label="Support conversations">
      <div className="support-inbox-tools">
        <button className="support-primary" type="button" aria-expanded={newChat} onClick={() => setNewChat((v) => !v)}>{newChat ? "Cancel" : "+ New conversation"}</button>
        {newChat && <div className="support-directory"><label htmlFor="support-user-search">Find a user by email</label><input id="support-user-search" autoFocus value={userSearch} onChange={(e) => { setUserSearch(e.target.value); setUsers([]); setDirectoryError(""); setDirectoryLoading(e.target.value.trim().length >= 2); }} placeholder="At least 2 characters" />
          {directoryError && <p role="alert">{directoryError}</p>}
          {directoryLoading && <p role="status">Searching…</p>}
          {!directoryLoading && !directoryError && userSearch.trim().length >= 2 && !users.length && <p>No users found.</p>}
          {users.map((u) => <button key={u.id} type="button" onClick={() => select(u)}>{u.email}</button>)}
        </div>}
        <label htmlFor="support-search">Search conversations</label><input id="support-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="User email" />
        <label htmlFor="support-filter">Show</label><select id="support-filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All conversations</option><option value="needs_reply">Needs reply</option><option value="resolved">Resolved</option></select>
      </div>
      {error && <p className="support-notice" role="alert">{error} <button onClick={() => void refresh()}>Retry</button></p>}
      {loading ? <p className="support-empty" role="status">Loading inbox…</p> : !items.length && <p className="support-empty">{search || filter !== "all" ? "No matching conversations." : "No conversations yet. Users can contact you from Support."}</p>}
      <ul>{items.map((item) => <li key={item.id}><button type="button" className="support-inbox-item" aria-current={selected?.id === item.userId ? "true" : undefined} onClick={() => select({ id: item.userId, email: item.email })}>
        <span className="support-inbox-person">{item.email}{item.unread > 0 && <span className="support-badge" aria-label={`${item.unread} unread messages`}>{item.unread}</span>}</span>
        <span className="support-preview">{item.latestRole === "admin" ? "Support: " : ""}{item.latestText}</span>
        <span className="support-inbox-meta">{item.status === "resolved" ? "Resolved" : item.latestRole === "user" ? "Needs reply" : "Awaiting user"} · {new Date(item.lastAt).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ })}</span>
      </button></li>)}</ul>
      {hasMore && <button type="button" className="support-older" disabled={moreLoading} onClick={async () => { setMoreLoading(true); visibleLimit.current += 30; await refresh(); setMoreLoading(false); }}>{moreLoading ? "Loading…" : "Load more conversations"}</button>}
    </aside>
    <div className="support-inbox-detail">{selected ? <SupportChat key={selected.id} admin userId={selected.id} email={selected.email} onUpdate={() => void refresh()} onBack={back} onDeleted={back} /> : <div className="support-empty support-select"><h2>Your support inbox</h2><p>Select a conversation to reply, or start one with a user.</p></div>}</div>
  </div>;
}
