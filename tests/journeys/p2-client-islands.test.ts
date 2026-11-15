import { describe, expect, it, vi } from "vitest";
import { createBookmarkStore } from "@/app/(viewer)/_components/bookmark-store";
import { summarizeInbox } from "@/app/api/me/inbox/summary";
import type { InboxItem } from "@/lib/announcements";

describe("bookmark subscriptions", () => {
  it("notifies only cards for the changed media kind and id", () => {
    const store = createBookmarkStore({ movies: ["tmdb-1"], shows: [] });
    const movie = vi.fn(), show = vi.fn(), other = vi.fn();
    store.subscribe("movie", "tmdb-1", movie);
    store.subscribe("show", "tmdb-1", show);
    const unsubscribe = store.subscribe("movie", "other", other);
    expect(store.has("movie", "tmdb-1")).toBe(true);
    expect(store.has("show", "tmdb-1")).toBe(false);
    store.set("movie", ["tmdb-1"], false);
    store.set("movie", ["tmdb-1"], false);
    expect(store.serverHas("movie", "tmdb-1")).toBe(true); // Hydrating later cards keep the original server snapshot.
    expect(movie).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    unsubscribe();
    store.set("movie", ["other"], true);
    expect(other).not.toHaveBeenCalled();
  });

  it("updates both title aliases without notifying unrelated cards", () => {
    const store = createBookmarkStore();
    const row = vi.fn(), tmdb = vi.fn();
    store.subscribe("movie", "uuid", row);
    store.subscribe("movie", "tmdb-9", tmdb);
    store.set("movie", ["uuid", "tmdb-9"], true);
    expect(store.has("movie", "uuid")).toBe(true);
    expect(store.has("movie", "tmdb-9")).toBe(true);
    expect(row).toHaveBeenCalledTimes(1);
    expect(tmdb).toHaveBeenCalledTimes(1);
  });
});

it("defers bell bodies while preserving visible priority announcements and total unread", () => {
  const item: InboxItem = { id: "one", title: "News", body: "Full text", priority: "inbox", imageUrl: null, bannerImageUrl: null, linkUrl: null, read: false, publishedAt: "2026-01-01T00:00:00.000Z" };
  const original = { unread: 80, items: [item, { ...item, id: "two", priority: "banner" as const }, { ...item, id: "three", priority: "popup" as const }] };
  const summary = summarizeInbox(original);
  expect(summary.unread).toBe(80);
  expect(summary.items.map(({ body, bodyLoaded }) => ({ body, bodyLoaded }))).toEqual([{ body: "", bodyLoaded: false }, { body: "Full text", bodyLoaded: true }, { body: "Full text", bodyLoaded: true }]);
  expect(summarizeInbox({ ...original, items: [{ ...item, body: "Edited" }] }).items[0].bodyVersion).not.toBe(summary.items[0].bodyVersion);
  expect(original.items[0].body).toBe("Full text");
});
