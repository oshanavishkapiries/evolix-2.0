"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { fetchWithRefresh, postJsonWithRefresh } from "@/lib/client/api";
import { createBookmarkStore, type BookmarkIds, type BookmarkKind as Kind } from "./bookmark-store";
import { BookmarkIcon } from "./icons";

type Store = ReturnType<typeof createBookmarkStore> & { toggle: (kind: Kind, id: string) => void; seed: (ids: BookmarkIds) => void };
const BookmarkContext = createContext<Store | null>(null);

/** Seeded visits avoid a mount request. Writes remain optimistic, with per-title serialization. */
export function BookmarkProvider({ children, initial }: { children: React.ReactNode; initial?: BookmarkIds }) {
  const router = useRouter();
  const [store] = useState<Store>(() => {
    const base = createBookmarkStore(initial);
    const revisions = new Map<string, number>();
    const confirmed = new Map<string, boolean>();
    let seeded = false;
    const writes = new Map<string, Promise<void>>();
    return { ...base, seed(ids) {
      if (seeded) return;
      seeded = true;
      base.set("movie", ids.movies.filter((id) => !revisions.has(`movie:${id}`)), true);
      base.set("show", ids.shows.filter((id) => !revisions.has(`show:${id}`)), true);
    }, toggle(kind, id) {
      const key = `${kind}:${id}`;
      if (!confirmed.has(key)) confirmed.set(key, base.has(kind, id));
      const on = !base.has(kind, id);
      const revision = (revisions.get(key) ?? 0) + 1;
      revisions.set(key, revision);
      base.set(kind, [id], on);
      const write = (writes.get(key) ?? Promise.resolve()).then(async () => {
        try {
          const result = await postJsonWithRefresh<{ ids?: string[] }>("/api/me/bookmarks", { kind, id, on });
          if (!result.ok) throw new Error("Bookmark write failed");
          confirmed.set(key, on);
          if (revisions.get(key) === revision) base.set(kind, result.ids ?? [id], on);
          startTransition(() => router.refresh());
        } catch {
          if (revisions.get(key) === revision) base.set(kind, [id], confirmed.get(key) ?? !on);
        }
      });
      writes.set(key, write);
      void write.finally(() => { if (writes.get(key) === write) writes.delete(key); });
    } };
  });
  useEffect(() => {
    if (initial) return;
    let live = true;
    void fetchWithRefresh("/api/me/bookmarks").then((r) => r.ok ? r.json() : null).then((data: BookmarkIds | null) => {
      if (live && data) { store.set("movie", data.movies, true); store.set("show", data.shows, true); }
    }).catch(() => {});
    return () => { live = false; };
  }, [initial, store]);
  return <BookmarkContext.Provider value={store}>{children}</BookmarkContext.Provider>;
}

export function useSeedBookmarks() { return useContext(BookmarkContext)?.seed; }

function useBookmark(kind: Kind, id: string) {
  const store = useContext(BookmarkContext);
  const subscribe = useCallback((notify: () => void) => store?.subscribe(kind, id, notify) ?? (() => {}), [store, kind, id]);
  const snapshot = useCallback(() => store?.has(kind, id) ?? false, [store, kind, id]);
  const serverSnapshot = useCallback(() => store?.serverHas(kind, id) ?? false, [store, kind, id]);
  const on = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return { on, toggle: (kind: Kind, id: string) => store?.toggle(kind, id) };
}

/** Small icon button for poster cards (sits beside the card link, not inside it). */
export function BookmarkToggle({ kind, id, title }: { kind: Kind; id: string; title: string }) {
  const { on, toggle } = useBookmark(kind, id);
  return (
    <button
      type="button"
      className="v-card-bm"
      data-on={on}
      aria-pressed={on}
      aria-label={`${on ? "Remove" : "Add"} ${title} ${on ? "from" : "to"} My List`}
      onClick={() => toggle(kind, id)}
    >
      <BookmarkIcon size={18} filled={on} />
    </button>
  );
}

/** Round icon button for the detail-page action row. */
export function BookmarkButton({ kind, id }: { kind: Kind; id: string }) {
  const { on, toggle } = useBookmark(kind, id);
  return (
    <button type="button" className="v-round" data-on={on} aria-pressed={on} aria-label={on ? "Remove from My List" : "Add to My List"} title={on ? "In My List" : "Add to My List"} onClick={() => toggle(kind, id)}>
      <BookmarkIcon size={20} filled={on} />
    </button>
  );
}
