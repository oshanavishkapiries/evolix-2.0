"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fetchWithRefresh } from "@/lib/client/api";
import type { SupportConversation, SupportMessage, SupportThread } from "@/lib/support/types";
import { TZ } from "@/lib/tz";
import { useVisiblePoll } from "./poll";
import { supportUpdated } from "./unread";

const day = (date: string) => new Date(date).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: TZ });
const time = (date: string) => new Date(date).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const merge = (a: SupportMessage[], b: SupportMessage[]) => [...new Map([...a, ...b].map((m) => [m.id, m])).values()].sort((a, b) => a.id - b.id);

export function SupportChat({ admin = false, userId, email, onUpdate, onBack }: {
  admin?: boolean; userId?: string; email?: string; onUpdate?: () => void; onBack?: () => void;
}) {
  const endpoint = admin ? `/api/admin/support/${userId}` : "/api/me/support";
  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [recipient, setRecipient] = useState(email);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlder] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SupportMessage | "history" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const latestId = useRef(0);
  const readId = useRef(0);
  const readingId = useRef(0);
  const nearBottom = useRef(true);
  const alive = useRef(true);
  const sendingNow = useRef(false);
  const syncing = useRef(false);
  const version = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const pending = useRef<{ text: string; clientId: string } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const dialog = deleteDialog.current;
    if (deleteTarget && dialog && !dialog.open) dialog.showModal();
    else if (!deleteTarget && dialog?.open) dialog.close();
  }, [deleteTarget]);

  async function acknowledge(id: number) {
    if (!id || id <= Math.max(readId.current, readingId.current) || document.visibilityState === "hidden" || !nearBottom.current || !alive.current) return;
    const bounds = list.current?.getBoundingClientRect();
    if (!bounds || bounds.height === 0 || bounds.bottom <= 0 || bounds.top >= window.innerHeight) return;
    readingId.current = id;
    try {
      const res = await fetchWithRefresh(`${endpoint}/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ through: id }) });
      if (res.ok && alive.current) { readId.current = Math.max(readId.current, id); supportUpdated(); onUpdate?.(); }
    } catch { /* The next poll retries the read receipt. */ }
    finally { if (readingId.current === id) readingId.current = readId.current; }
  }

  function bottom() {
    nearBottom.current = true;
    setNewMessages(false);
    requestAnimationFrame(() => {
      if (list.current) list.current.scrollTop = list.current.scrollHeight;
      void acknowledge(latestId.current);
    });
  }

  async function sync() {
    if (syncing.current || !alive.current) return;
    syncing.current = true;
    const requestedGeneration = generation.current;
    try {
      const params = new URLSearchParams();
      if (latestId.current) params.set("after", String(latestId.current));
      if (version.current) params.set("version", version.current);
      const url = `${endpoint}?${params}`;
      const res = await fetchWithRefresh(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Messages couldn’t be loaded. Please try again.");
      const data: SupportThread = await res.json();
      if (!alive.current || requestedGeneration !== generation.current) return;
      setConversation(data.conversation);
      setRecipient(data.conversation?.email ?? data.recipientEmail ?? email);
      version.current = data.version;
      if (!loaded.current || data.reset) setHasOlder(data.hasMore);
      loaded.current = true;
      if (data.reset) {
        generation.current += 1; // discard older in-flight pages that could contain deleted text
        setMessages(data.messages);
        latestId.current = data.messages.at(-1)?.id ?? data.clearedThrough ?? 0;
        setNewMessages(false);
      }
      if (data.messages.length) {
        latestId.current = Math.max(latestId.current, data.messages[data.messages.length - 1].id);
        setMessages((old) => merge(old, data.messages));
        if (nearBottom.current) bottom(); else if (!data.reset) setNewMessages(true);
      }
      setError("");
      await acknowledge(latestId.current);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Connection interrupted. Retrying…");
    } finally {
      syncing.current = false;
      if (alive.current) setLoading(false);
    }
  }
  useVisiblePoll(sync, 5000);

  async function older() {
    if (olderLoading || !messages.length) return;
    setOlderLoading(true);
    const previousHeight = list.current?.scrollHeight ?? 0;
    const previousTop = list.current?.scrollTop ?? 0;
    const requestedGeneration = generation.current;
    try {
      const params = new URLSearchParams({ before: String(messages[0].id) });
      if (version.current) params.set("version", version.current);
      const res = await fetchWithRefresh(`${endpoint}?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Older messages couldn’t be loaded.");
      const data: SupportThread = await res.json();
      if (!alive.current || requestedGeneration !== generation.current) return;
      version.current = data.version;
      if (data.reset) {
        generation.current += 1;
        setMessages(data.messages); setHasOlder(data.hasMore);
        latestId.current = data.messages.at(-1)?.id ?? data.clearedThrough ?? 0;
        bottom(); return;
      }
      nearBottom.current = false;
      setMessages((old) => merge(old, data.messages));
      setHasOlder(data.hasMore);
      requestAnimationFrame(() => { if (list.current) list.current.scrollTop = previousTop + list.current.scrollHeight - previousHeight; });
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setOlderLoading(false); }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sendingNow.current) return;
    sendingNow.current = true;
    setSending(true); setSendError(""); setSent(false);
    if (pending.current?.text !== text) pending.current = { text, clientId: crypto.randomUUID() };
    try {
      const res = await fetchWithRefresh(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.current) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Message wasn’t sent. Please try again.");
      if (!alive.current) return;
      pending.current = null;
      setDraft(""); setSent(true);
      // Refresh from the last fetched ID; inserting just the sent message could skip an incoming reply.
      bottom();
      await sync();
      supportUpdated(); onUpdate?.();
    } catch (e) { if (alive.current) setSendError(e instanceof Error && !(e instanceof TypeError) ? e.message : "Message wasn’t sent. Your draft is still here."); }
    finally { sendingNow.current = false; if (alive.current) setSending(false); }
  }

  async function changeStatus() {
    if (!conversation || statusBusy) return;
    setStatusBusy(true);
    try {
      const status = conversation.status === "resolved" ? "open" : "resolved";
      const res = await fetchWithRefresh(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      if (!res.ok) throw new Error("Conversation status couldn’t be changed.");
      setConversation({ ...conversation, status }); onUpdate?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setStatusBusy(false); }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting || admin) return;
    setDeleting(true); setDeleteError("");
    try {
      const target = deleteTarget;
      const url = target === "history" ? endpoint : `${endpoint}/messages/${target.id}`;
      const res = await fetchWithRefresh(url, { method: "DELETE" });
      if (!res.ok) throw new Error("This couldn’t be deleted. Please try again.");
      if (!alive.current) return;
      generation.current += 1;
      if (target === "history") {
        setMessages([]); setHasOlder(false); setNewMessages(false);
        latestId.current = 0; loaded.current = false; version.current = undefined;
      } else {
        setMessages((old) => old.map((m) => m.id === target.id ? { ...m, text: "Message deleted", deletedAt: new Date().toISOString() } : m));
      }
      setDeleteTarget(null);
      supportUpdated(); onUpdate?.();
      await sync();
    } catch { if (alive.current) setDeleteError("This couldn’t be deleted. Please try again."); }
    finally { if (alive.current) setDeleting(false); }
  }

  return (
    <section className="support-chat" aria-label={admin ? `Support conversation with ${email || "user"}` : "Your support conversation"}>
      <header className="support-chat-head">
        <div className="support-chat-title">{onBack && <button type="button" className="support-mobile-back support-quiet" onClick={onBack}>← Inbox</button>}{admin ? <h2>{recipient || "New conversation"}</h2> : <h1>Evolix Support</h1>}<p>{conversation?.status === "resolved" ? "Resolved · Send a message to reopen this conversation." : admin ? "Private conversation" : "Talk to the Evolix team. We’ll reply here."}</p></div>
        {admin && <div className="support-actions"><Link href={`/admin/users/${userId}`}>View user</Link>{conversation && <button type="button" className="support-quiet" disabled={statusBusy} onClick={changeStatus}>{conversation.status === "resolved" ? "Reopen" : "Resolve"}</button>}</div>}
        {!admin && messages.length > 0 && <button type="button" className="support-quiet" onClick={() => { setDeleteError(""); setDeleteTarget("history"); }}>Clear history</button>}
      </header>
      {error && <div className="support-notice" role="status">{error} <button type="button" onClick={() => void sync()}>Retry</button></div>}
      <div className="support-messages" role="log" aria-live="polite" aria-relevant="additions" ref={list} tabIndex={0} aria-label="Message history" onScroll={() => {
        const el = list.current;
        if (!el) return;
        nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
        if (nearBottom.current) { setNewMessages(false); void acknowledge(latestId.current); }
      }}>
        {hasOlder && <button type="button" className="support-older" disabled={olderLoading} onClick={older}>{olderLoading ? "Loading…" : "Load older messages"}</button>}
        {loading ? <p className="support-empty" role="status">Loading conversation…</p> : !messages.length && <div className="support-empty"><h3>{admin ? "Start a conversation" : "How can we help?"}</h3><p>{admin ? "Your first message will appear in this user’s Support chat." : "Tell us what happened, ask a question, or share an idea."}</p></div>}
        {messages.map((m, i) => {
          const mine = m.senderRole === (admin ? "admin" : "user");
          return <div key={m.id}>
            {(i === 0 || day(messages[i - 1].createdAt) !== day(m.createdAt)) && <p className="support-day">{day(m.createdAt)}</p>}
            <article className="support-message" data-mine={mine} data-deleted={Boolean(m.deletedAt)}>
              <p className="support-sender">{m.senderRole === "admin" ? "Evolix Support" : admin ? "User" : "You"}</p>
              <p className="support-message-text">{m.text}</p>
              <footer className="support-message-meta"><time dateTime={new Date(m.createdAt).toISOString()} title={new Date(m.createdAt).toLocaleString("en-GB", { timeZone: TZ })}>{time(m.createdAt)}</time>
                {!admin && mine && !m.deletedAt && <button type="button" className="support-delete" aria-label="Delete your message" onClick={() => { setDeleteError(""); setDeleteTarget(m); }}>Delete</button>}
              </footer>
            </article>
          </div>;
        })}
      </div>
      {newMessages && <button type="button" className="support-new" onClick={bottom}>New messages ↓</button>}
      <form className="support-composer" onSubmit={send}>
        <label htmlFor="support-message">{admin ? "Reply to user" : "Your message"}</label>
        <div><textarea id="support-message" value={draft} maxLength={2000} rows={2} placeholder="Write a message…" disabled={sending} onChange={(e) => { setDraft(e.target.value); setSent(false); }} />
          <button type="submit" disabled={sending || !draft.trim()}>{sending ? "Sending…" : sendError ? "Retry send" : "Send"}</button></div>
        <div className="support-composer-meta"><span role={sendError ? "alert" : "status"}>{sendError || (sent ? "Message sent" : "Replies may take a little time.")}</span><span>{draft.length}/2000</span></div>
      </form>
      <dialog ref={deleteDialog} className="support-confirm" aria-labelledby="support-delete-title" aria-describedby="support-delete-description" onCancel={(e) => { if (deleting) e.preventDefault(); else setDeleteTarget(null); }}>
        <h2 id="support-delete-title">{deleteTarget === "history" ? "Clear chat history?" : "Delete this message?"}</h2>
        <p id="support-delete-description">{deleteTarget === "history" ? "This clears the conversation from your view on all your devices. The support team keeps its copy. New replies will still appear here." : "Your message will be replaced with “Message deleted” for you and the support team. This can’t be undone."}</p>
        {deleteError && <p role="alert">{deleteError}</p>}
        <div><button type="button" className="support-quiet" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="support-danger" disabled={deleting} onClick={confirmDelete}>{deleting ? "Deleting…" : deleteTarget === "history" ? "Clear history" : "Delete message"}</button></div>
      </dialog>
    </section>
  );
}
