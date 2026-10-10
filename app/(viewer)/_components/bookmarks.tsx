"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchWithRefresh, postJsonWithRefresh } from "@/lib/client/api";
import { BookmarkIcon } from "./icons";

type Kind = "movie" | "show";
type Ctx = { has: (kind: Kind, id: string) => boolean; toggle: (kind: Kind, id: string) => void; ready: boolean };

const BookmarkContext = createContext<Ctx>({ has: () => false, toggle: () => {}, ready: false });

/** Loads the user's bookmark ids once per visit; toggles are optimistic and roll back on failure. */
export function BookmarkProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    fetchWithRefresh("/api/me/bookmarks")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { movies?: string[]; shows?: string[] } | null) => {
        if (live && b) setIds(new Set([...(b.movies ?? []), ...(b.shows ?? [])]));
      })
      .catch(() => {})
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);

  const set = useCallback((id: string, on: boolean) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggle = useCallback(
    (kind: Kind, id: string) => {
      const on = !ids.has(id);
      set(id, on);
      postJsonWithRefresh("/api/me/bookmarks", { kind, id, on }).then((r) => {
        if (!r.ok) set(id, !on);
      });
    },
    [ids, set],
  );

  const value = useMemo(() => ({ has: (_k: Kind, id: string) => ids.has(id), toggle, ready }), [ids, toggle, ready]);
  return <BookmarkContext.Provider value={value}>{children}</BookmarkContext.Provider>;
}

/** Small icon button for poster cards (sits beside the card link, not inside it). */
export function BookmarkToggle({ kind, id, title }: { kind: Kind; id: string; title: string }) {
  const { has, toggle } = useContext(BookmarkContext);
  const on = has(kind, id);
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
  const { has, toggle } = useContext(BookmarkContext);
  const on = has(kind, id);
  return (
    <button type="button" className="v-round" data-on={on} aria-pressed={on} aria-label={on ? "Remove from My List" : "Add to My List"} title={on ? "In My List" : "Add to My List"} onClick={() => toggle(kind, id)}>
      <BookmarkIcon size={20} filled={on} />
    </button>
  );
}
