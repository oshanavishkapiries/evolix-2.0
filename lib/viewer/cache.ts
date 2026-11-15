import { cacheLife, cacheTag } from "next/cache";

/** Umbrella tag retained for explicit full-catalog flushes. */
export const CATALOG_TAG = "catalog";
export const catalogListTag = "catalog:list";
export const titleTag = (kind: "movie" | "show", id: string) => `catalog:${kind}:${id}`;
export const tmdbTag = (kind: "movie" | "tv", tmdbId: number) => `tmdb:${kind}:${tmdbId}`;
export const settingTag = (key: string) => `setting:${key}`;

/** Shared lifetime and umbrella tag; callers also attach their list/title tags. */
export function catalogCache() {
  cacheTag(CATALOG_TAG);
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
}
