import { registeredEngines, engineToken } from "./registry";
import { fetchEngine, EngineUnavailableError } from "./transport";
export { DEFAULT_TIMEOUT_MS, EngineUnavailableError } from "./transport";

/**
 * Resolves engine addresses and credentials, and applies the shared transport timeouts.
 * Every app-to-engine call goes through `engineFetch`.
 */
import { type EngineRef } from "@/lib/config/engine-list";
export { parseEngines, engineIdFor, type EngineRef } from "@/lib/config/engine-list";

/** DB-managed records replace the env list as soon as one exists. */
export const engines = registeredEngines;

export async function defaultEngine(): Promise<EngineRef> {
  const engine = (await engines())[0];
  if (!engine) throw new EngineUnavailableError("No Evo engine configured");
  return engine;
}
export const engineById = async (id: string): Promise<EngineRef | undefined> => (await engines()).find((e) => e.id === id);

export type EngineCall = {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "DELETE";
  /** JSON-encoded unless a string is given. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Milliseconds to wait for the engine to start answering. The body is not time-limited, so streams may run long. */
  timeoutMs?: number;
  engine?: EngineRef;
};

/** Every engine call uses its own token, falling back to the global credential. */
export async function engineFetch(path: string, call: EngineCall = {}): Promise<Response> {
  const engine = call.engine ?? (await defaultEngine());
  if (!engine) throw new Error("No Evo engine configured");
  return fetchEngine(engine.url, path, await engineToken(engine.id), call);
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
