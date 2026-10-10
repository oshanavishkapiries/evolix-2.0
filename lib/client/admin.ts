import { fetchWithRefresh } from "./api";

export type AdminResult<T = Record<string, unknown>> = {
  ok: boolean;
  status: number;
  message?: string;
  issues?: { path: string; message: string }[];
} & T;

/** JSON call to the admin API (refreshes the session on 401). */
export async function adminApi<T = Record<string, unknown>>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<AdminResult<T>> {
  try {
    const res = await fetchWithRefresh(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: Record<string, unknown> = {};
    try {
      data = await res.json();
    } catch {}
    return { ...(data as T), ok: res.ok, status: res.status } as AdminResult<T>;
  } catch {
    return { ok: false, status: 0, message: "Network error" } as AdminResult<T>;
  }
}

export function errorText(res: AdminResult): string {
  const issues = res.issues?.map((i) => `${i.path || "body"}: ${i.message}`).join("; ");
  return [res.message ?? `Request failed (${res.status})`, issues].filter(Boolean).join(" - ");
}

export const tmdbImage = (path: unknown, size = "w185") =>
  typeof path === "string" && path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

// ---- videos

import type { VideoSite, VideoType } from "@/lib/videos";

export type AdminVideo = {
  id: string;
  site: VideoSite;
  key: string;
  name: string;
  type: VideoType;
  official: boolean;
  language: string | null;
  publishedAt: string | null;
  sortOrder: number;
  isVisible: boolean;
};
export type VideoParent = { movieId: string } | { showId: string };
export type VideoFields = Partial<Omit<AdminVideo, "id" | "publishedAt">>;

export const listVideos = (parent: VideoParent) =>
  adminApi<{ videos: AdminVideo[] }>("GET", `/api/admin/videos?${new URLSearchParams(parent)}`);
export const createVideo = (parent: VideoParent, fields: VideoFields) =>
  adminApi<{ video: AdminVideo }>("POST", "/api/admin/videos", { ...parent, ...fields });
export const updateVideo = (id: string, fields: VideoFields) =>
  adminApi<{ video: AdminVideo }>("PATCH", `/api/admin/videos/${id}`, fields);
export const deleteVideo = (id: string) => adminApi("DELETE", `/api/admin/videos/${id}`);
export const importTmdbVideos = (parent: VideoParent) =>
  adminApi<{ added: number; skipped: number }>("POST", "/api/admin/videos/import-from-tmdb", parent);
