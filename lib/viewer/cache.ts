import { cacheLife, cacheTag } from "next/cache";

/** Tag shared by every cached public catalog read; admin writes expire it (see adminRoute). */
export const CATALOG_TAG = "catalog";

/**
 * Call at the top of a `"use cache"` function. The database is a network hop away, so public
 * reads are served from the cache for a few minutes and expired immediately on any admin write.
 */
export function catalogCache() {
  cacheTag(CATALOG_TAG);
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
}
