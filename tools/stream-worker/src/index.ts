import { corsHeaders, enginePath, parseEngines, parsePath, parseFilePath, rewritePlaylist } from "./core";

/**
 * Cloudflare Worker: an HTTPS door for video. The browser plays from here instead of from the Vercel function, so
 * the video bytes never count as Vercel Fast Origin Transfer. Engines stay plain http and are not changed.
 *
 *   browser --https--> this Worker --http--> engine  (/api/v1/media/stream/<task>/..., with the shared secret)
 *
 * Settings (wrangler.toml / dashboard): EVO_ENGINES and ALLOWED_ORIGINS as variables, EVO_SECRET_TOKEN as a secret.
 */
export interface Env {
  EVO_ENGINES: string;
  EVO_SECRET_TOKEN: string;
  ALLOWED_ORIGINS: string;
}

const HEADER_TIMEOUT_MS = 30_000;
const PASS = ["content-type", "content-length", "content-range", "accept-ranges"];

const reply = (status: number, text: string, cors: Headers) => new Response(text, { status, headers: new Headers([...cors, ["Cache-Control", "no-store"], ["Content-Type", "text/plain; charset=utf-8"]]) });

const worker = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req.headers.get("Origin"), env.ALLOWED_ORIGINS ?? "");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET" && req.method !== "HEAD") return reply(405, "Method not allowed", cors);

    const url = new URL(req.url);
    const file = parseFilePath(url.pathname);
    const path = parsePath(url.pathname);
    if (!path && !file) return reply(404, "Not found", cors);

    const engine = (await parseEngines(env.EVO_ENGINES)).find((e) => e.key === (file ?? path)!.key);
    if (!engine) return reply(404, "Not found", cors);

    const headers: Record<string, string> = {};
    if (env.EVO_SECRET_TOKEN) headers["X-Evo-Secret"] = env.EVO_SECRET_TOKEN;
    const range = req.headers.get("Range");
    if (range) headers["Range"] = range;
    const ifRange = req.headers.get("If-Range");
    if (ifRange) headers["If-Range"] = ifRange;

    // Wait a limited time for the engine to start answering; the body (a segment) then streams without a deadline.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HEADER_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${engine.url}${file ? `/api/v1/media/files/${file.fileId}` : enginePath(path!, url.search)}`, { method: req.method, headers, signal: ctrl.signal, redirect: "error" });
    } catch (e) {
      return reply(502, e instanceof Error && e.name !== "AbortError" ? "Stream source unreachable" : "Stream source timed out", cors);
    } finally {
      clearTimeout(timer);
    }
    if (file) {
      const out = new Headers(cors);
      out.set("Cache-Control", res.ok ? "private, max-age=3600" : "no-store");
      for (const h of [...PASS, "etag", "last-modified"]) {
        const value = res.headers.get(h);
        if (value) out.set(h, value);
      }
      if (!res.ok) out.delete("content-length");
      // Error bodies may contain engine details; keep only their status and range headers.
      if (!res.ok || req.method === "HEAD") await res.body?.cancel().catch(() => {});
      return new Response(res.ok && req.method !== "HEAD" ? res.body : null, { status: res.status, headers: out });
    }
    if (!path) return reply(404, "Not found", cors);
    if (!res.ok && res.status !== 206) {
      await res.body?.cancel().catch(() => {});
      return reply(res.status, `Stream error: ${res.status}`, cors);
    }

    if (path.file !== "segment") {
      // Playlists are small and must not be cached: they carry short-lived signed child URLs.
      const text = rewritePlaylist(await res.text(), path.taskId, path.key);
      return new Response(req.method === "HEAD" ? null : text, {
        status: 200,
        headers: new Headers([...cors, ["Content-Type", "application/vnd.apple.mpegurl"], ["Cache-Control", "no-cache, no-store, must-revalidate"]]),
      });
    }

    const out = new Headers(cors);
    out.set("Cache-Control", "private, max-age=300");
    for (const h of PASS) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    if (!out.get("content-type") || out.get("content-type")!.startsWith("text/")) out.set("content-type", "video/mp2t");
    return new Response(req.method === "HEAD" ? null : res.body, { status: res.status, headers: out });
  },
};

export default worker;
