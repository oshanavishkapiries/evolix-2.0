/** Local CDN identifiers are opaque names, never URLs or filesystem paths. Client safe. */
export const LOCAL_FILE_ID = /^[a-f0-9]{32,64}\.[a-z0-9]{1,10}$/;
export function localFileId(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith("evo-local://")) return null;
  const id = url.slice("evo-local://".length);
  return LOCAL_FILE_ID.test(id) ? id : null;
}

/** Recognize resolved local files in the player so an evicted source can use the existing heal flow. */
export function isLocalPlaybackUrl(url: string): boolean {
  try {
    const path = new URL(url, "https://app.invalid").pathname;
    const match = /(?:\/api\/evo\/file\/[0-9a-f]{8}|\/[0-9a-f]{8}\/file)\/([^/]+)$/.exec(path);
    return Boolean(match && LOCAL_FILE_ID.test(match[1]));
  } catch { return false; }
}
