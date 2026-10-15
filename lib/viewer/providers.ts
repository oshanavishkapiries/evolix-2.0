/**
 * Provider-specific source handling. Pure and client-safe: used by the watch data layer
 * (canonical URLs) and by the player (MIME types and fallbacks).
 */

export type SourceKind = "direct" | "hls" | "embed";

const PIXELDRAIN_HOSTS = new Set(["pixeldrain.com", "www.pixeldrain.com", "pixeldra.in", "pixeldrain.net"]);
// Pixeldrain file ids are short alphanumeric strings; /api/file/{id}, /u/{id}, /l/{listId}#{n}, ...
const PIXELDRAIN_PATH = /^\/(?:api\/file|u|file)\/([A-Za-z0-9]{4,})(?:\/|$)/;

export function pixeldrainId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!PIXELDRAIN_HOSTS.has(u.hostname.toLowerCase())) return null;
    return PIXELDRAIN_PATH.exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export const pixeldrainFileUrl = (id: string) => `https://pixeldrain.com/api/file/${id}?download`;
export const pixeldrainInfoUrl = (id: string) => `https://pixeldrain.com/api/file/${id}/info`;

/** Rewrites provider links to their playable form; other sources pass through unchanged. */
export function normalizeSource<T extends { kind: SourceKind; url: string }>(source: T): T {
  const id = pixeldrainId(source.url);
  if (id) return { ...source, kind: "direct", url: pixeldrainFileUrl(id) };
  return source;
}

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  ogg: "video/ogg",
  mov: "video/mp4",
  mkv: "video/webm",
  m3u8: "application/x-mpegurl",
};

export type PlayerType = "video/mp4" | "video/webm" | "video/ogg" | "application/x-mpegurl";

const extOf = (name: string) => name.split("?")[0].split(".").pop()?.toLowerCase() ?? "";

export function typeFromName(name: string): PlayerType | null {
  return (MIME_BY_EXT[extOf(name)] as PlayerType | undefined) ?? null;
}

/** Ordered playback candidates; the player advances to the next one when a candidate fails. */
export function playbackCandidates(kind: SourceKind, url: string, hintedType?: PlayerType | null) {
  const candidates: { src: string; type: PlayerType }[] = [];
  const push = (type: PlayerType) => {
    if (!candidates.some((c) => c.type === type)) candidates.push({ src: url, type });
  };
  if (kind === "hls") return [{ src: url, type: "application/x-mpegurl" as const }];

  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split("?")[0] || "";
  }
  const ext = typeFromName(pathname);
  if (ext === "application/x-mpegurl") return [{ src: url, type: ext }];
  if (hintedType) push(hintedType);
  if (ext) push(ext);
  // Extension-less / unknown (e.g. Pixeldrain): mp4 first, then the other common containers.
  push("video/mp4");
  push("video/webm");
  return candidates;
}
