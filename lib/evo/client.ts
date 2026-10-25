import { env } from "@/lib/env";

/**
 * The only place that knows where an Evo engine lives, adds the shared secret and applies timeouts.
 * Every app-to-engine call goes through `engineFetch`.
 */
export type EngineRef = { id: string; url: string; name: string };

const MEDIA = "/api/v1/media";

/** Stable id for an engine: its address. It survives reordering the list; changing the address makes it a new engine. */
export function engineIdFor(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `-${u.port}` : ""}${u.pathname.replace(/\/+$/, "").replace(/[^\w]+/g, "-")}`.toLowerCase();
  } catch {
    return url.replace(/[^\w]+/g, "-").toLowerCase();
  }
}

/** Parses EVO_ENGINES (JSON array of URLs or {url, name}); without it, the single EVO_ENGINE_URL is the only engine. */
export function parseEngines(list: string, single: string): EngineRef[] {
  let entries: { url: string; name?: string }[];
  if (list.trim()) {
    let raw: unknown;
    try {
      raw = JSON.parse(list);
    } catch {
      throw new Error("EVO_ENGINES must be a JSON array, e.g. [\"http://10.0.0.1:8000\", \"http://10.0.0.2:8000\"]");
    }
    if (!Array.isArray(raw) || raw.length === 0) throw new Error("EVO_ENGINES must be a non-empty JSON array");
    entries = raw.map((e) => {
      const entry = typeof e === "string" ? { url: e } : (e as { url?: unknown; name?: unknown });
      if (typeof entry.url !== "string" || !/^https?:\/\//.test(entry.url)) throw new Error(`EVO_ENGINES has an invalid engine URL: ${JSON.stringify(e)}`);
      return { url: entry.url, name: typeof entry.name === "string" ? entry.name : undefined };
    });
  } else {
    entries = [{ url: single }];
  }
  const seen = new Set<string>();
  return entries.map((e) => {
    const url = e.url.replace(/\/+$/, "");
    const id = engineIdFor(url);
    if (seen.has(id)) throw new Error(`EVO_ENGINES lists ${url} twice`);
    seen.add(id);
    return { id, url, name: e.name ?? id };
  });
}

let configured: EngineRef[] | null = null;

/** Engines this deployment can talk to, fixed until restart. The first one is the primary (owner of tasks from before multi-engine). */
export function engines(): EngineRef[] {
  return (configured ??= parseEngines(env.EVO_ENGINES, env.EVO_ENGINE_URL));
}

export const defaultEngine = (): EngineRef => engines()[0];
export const engineById = (id: string): EngineRef | undefined => engines().find((e) => e.id === id);

export class EngineUnavailableError extends Error {
  constructor(message = "The Evo engine did not answer") {
    super(message);
  }
}

export type EngineCall = {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "DELETE";
  /** JSON-encoded unless a string is given. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Milliseconds to wait for the engine to start answering. The body is not time-limited, so streams may run long. */
  timeoutMs?: number;
  engine?: EngineRef;
};

export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Calls the engine. `path` is relative to the media API ("/ingest"), or absolute ("/health") when it starts with
 * "/health". Resolves with the raw Response (a streaming body stays a stream); rejects with EngineUnavailableError
 * when the engine cannot be reached or does not answer in time.
 */
export async function engineFetch(path: string, call: EngineCall = {}): Promise<Response> {
  const engine = call.engine ?? defaultEngine();
  const headers: Record<string, string> = { ...call.headers };
  if (env.EVO_SECRET_TOKEN) headers["X-Evo-Secret"] = env.EVO_SECRET_TOKEN;
  let body: BodyInit | undefined;
  if (call.body !== undefined) {
    body = typeof call.body === "string" ? call.body : JSON.stringify(call.body);
    if (typeof call.body !== "string") headers["Content-Type"] = "application/json";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), call.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const url = path.startsWith("/health") ? `${engine.url}${path}` : `${engine.url}${MEDIA}${path}`;
    return await fetch(url, { method: call.method ?? "GET", headers, body, cache: "no-store", signal: ctrl.signal });
  } catch (e) {
    throw new EngineUnavailableError(e instanceof Error && e.name !== "AbortError" ? e.message : undefined);
  } finally {
    clearTimeout(timer); // headers are in (or we gave up); the body is read without a deadline
  }
}

/** JSON call: `data` is the parsed body ({} when it is not JSON). */
export async function engineJson<T = Record<string, unknown>>(path: string, call: EngineCall = {}) {
  const res = await engineFetch(path, call);
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

/** Parsed JSON of a successful GET, or null when the engine is down or refuses. Never throws. */
export async function engineGet<T>(path: string, timeoutMs = 5000, engine?: EngineRef): Promise<T | null> {
  try {
    const res = await engineFetch(path, { timeoutMs, engine });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
