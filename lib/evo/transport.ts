/** Shared transport for registered engines and unsaved connection tests. Never follows redirects with a token. */
export const DEFAULT_TIMEOUT_MS = 15_000;
export class EngineUnavailableError extends Error {
  constructor(message = "The Evo engine did not answer") { super(message); }
}
export async function fetchEngine(url: string, path: string, token: string, call: {
  method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number;
} = {}): Promise<Response> {
  // Header names are case insensitive; strip every spelling before selecting the credential.
  const headers: Record<string, string> = Object.fromEntries(Object.entries(call.headers ?? {}).filter(([key]) => key.toLowerCase() !== "x-evo-secret"));
  if (token) headers["X-Evo-Secret"] = token;
  let body: BodyInit | undefined;
  if (call.body !== undefined) {
    body = typeof call.body === "string" ? call.body : JSON.stringify(call.body);
    if (typeof call.body !== "string") headers["Content-Type"] = "application/json";
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), call.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(`${url}${path.startsWith("/health") ? "" : "/api/v1/media"}${path}`, {
      method: call.method ?? "GET", headers, body, cache: "no-store", signal: ctrl.signal, redirect: "error",
    });
  } catch { throw new EngineUnavailableError(); }
  finally { clearTimeout(timer); }
}
