import { getConfig } from "@/lib/config";

/**
 * The only place that knows where an Evo engine lives, adds the shared secret and applies timeouts.
 * Every app-to-engine call goes through `engineFetch`.
 */
import { parseEngines, type EngineRef } from "@/lib/config/engine-list";
export { parseEngines, engineIdFor, type EngineRef } from "@/lib/config/engine-list";

const MEDIA = "/api/v1/media";

let configured: EngineRef[] | null = null;
let configuredValue: string | undefined;

/** Engines this deployment can talk to, refreshed when config changes. The first one is the primary (owner of tasks from before multi-engine). */
export async function engines(): Promise<EngineRef[]> {
  const value = (await getConfig()).EVO_ENGINES;
  if (!configured || configuredValue !== value) {
    configured = parseEngines(value);
    configuredValue = value;
  }
  return configured;
}

export const defaultEngine = async (): Promise<EngineRef> => (await engines())[0];
export const engineById = async (id: string): Promise<EngineRef | undefined> => (await engines()).find((e) => e.id === id);

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
  const engine = call.engine ?? (await defaultEngine());
  const headers: Record<string, string> = { ...call.headers };
  if ((await getConfig()).EVO_SECRET_TOKEN) headers["X-Evo-Secret"] = (await getConfig()).EVO_SECRET_TOKEN;
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
