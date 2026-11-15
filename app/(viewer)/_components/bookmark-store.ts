export type BookmarkKind = "movie" | "show";
export type BookmarkIds = { movies: string[]; shows: string[] };

/** Stable provider value with subscriptions scoped to a single kind/id. */
export function createBookmarkStore(initial?: BookmarkIds) {
  const ids = new Set<string>([...(initial?.movies ?? []).map((id) => `movie:${id}`), ...(initial?.shows ?? []).map((id) => `show:${id}`)]);
  const serverIds = new Set(ids);
  const listeners = new Map<string, Set<() => void>>();
  return {
    has: (kind: BookmarkKind, id: string) => ids.has(`${kind}:${id}`),
    serverHas: (kind: BookmarkKind, id: string) => serverIds.has(`${kind}:${id}`),
    subscribe(kind: BookmarkKind, id: string, callback: () => void) {
      const key = `${kind}:${id}`;
      let subscribers = listeners.get(key);
      if (!subscribers) listeners.set(key, subscribers = new Set());
      subscribers.add(callback);
      return () => { subscribers.delete(callback); if (!subscribers.size) listeners.delete(key); };
    },
    set(kind: BookmarkKind, values: string[], on: boolean) {
      for (const id of values) {
        const key = `${kind}:${id}`;
        if (ids.has(key) === on) continue;
        if (on) ids.add(key); else ids.delete(key);
        listeners.get(key)?.forEach((callback) => callback());
      }
    },
  };
}
