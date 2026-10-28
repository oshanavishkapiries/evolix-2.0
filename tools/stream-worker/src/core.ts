/**
 * Pure helpers of the stream Worker. No Cloudflare APIs here, so they run (and are tested) under Node too.
 *
 * The Worker is a thin HTTPS door in front of the engines' existing /api/v1/media/stream routes. It changes no
 * engine behaviour: it calls the same paths the Vercel proxy calls, with the same shared secret.
 */

const MEDIA_STREAM = "/api/v1/media/stream";

export type Engine = { key: string; url: string };

/** Same rule as lib/evo/client.ts `engineIdFor`: the engine's address, so the Worker and the app agree on ids. */
export function engineIdFor(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `-${u.port}` : ""}${u.pathname.replace(/\/+$/, "").replace(/[^\w]+/g, "-")}`.toLowerCase();
  } catch {
    return url.replace(/[^\w]+/g, "-").toLowerCase();
  }
}

/** Short public id of an engine: the first 8 hex digits of SHA-256(engine id). Hides the engine's address from viewers. */
export async function engineKey(engineId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(engineId));
  return [...new Uint8Array(digest)].slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads the same EVO_ENGINES value the app uses: a JSON array of URLs or {url, name}, or a comma-separated list. */
export async function parseEngines(list: string): Promise<Engine[]> {
  let text = (list ?? "").trim();
  while (text.length > 1 && /^(["'])[\s\S]*\1$/.test(text)) text = text.slice(1, -1).trim();
  let raw: unknown;
  if (text.startsWith("[")) {
    try {
      raw = JSON.parse(text);
    } catch {
      return [];
    }
  } else {
    raw = text.split(/[,\s]+/).filter(Boolean);
  }
  if (!Array.isArray(raw)) return [];
  const out: Engine[] = [];
  for (const e of raw) {
    const url = typeof e === "string" ? e : (e as { url?: unknown })?.url;
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) continue;
    const clean = url.replace(/\/+$/, "");
    out.push({ key: await engineKey(engineIdFor(clean)), url: clean });
  }
  return out;
}

/** The only three things a viewer may ask for. Anything else is refused before any engine is contacted. */
export type StreamPath = { key: string; taskId: string; file: "master.m3u8" | "variant.m3u8" | "segment" };

const PATH = /^\/([0-9a-f]{8})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(master\.m3u8|variant\.m3u8|segment)$/i;

export function parsePath(pathname: string): StreamPath | null {
  const m = PATH.exec(pathname);
  return m ? { key: m[1].toLowerCase(), taskId: m[2].toLowerCase(), file: m[3] as StreamPath["file"] } : null;
}

/** Points a playlist's child URLs back at the Worker instead of the engine's own path. */
export function rewritePlaylist(text: string, taskId: string, key: string) {
  return text.replaceAll(`${MEDIA_STREAM}/${taskId}`, `/${key}/${taskId}`);
}

export const enginePath = (p: StreamPath, search: string) => `${MEDIA_STREAM}/${p.taskId}/${p.file}${search}`;

/** CORS for the allowed site(s) only: other sites cannot play from this Worker in a browser. */
export function corsHeaders(origin: string | null, allowed: string): Headers {
  const h = new Headers({ Vary: "Origin" });
  const list = allowed.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  if (origin && (list.includes("*") || list.includes(origin))) {
    h.set("Access-Control-Allow-Origin", list.includes("*") ? "*" : origin);
    h.set("Access-Control-Allow-Headers", "Range");
    h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    h.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    h.set("Access-Control-Max-Age", "86400");
  }
  return h;
}
