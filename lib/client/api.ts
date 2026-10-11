export type ApiResult<T = Record<string, unknown>> = {
  status: number;
  ok: boolean;
  message?: string;
  code?: string;
  retryAfter?: number;
} & T;

async function parse<T>(res: Response): Promise<ApiResult<T>> {
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {}
  return { ...(body as T), status: res.status, ok: res.ok } as ApiResult<T>;
}

export async function postJson<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return await parse<T>(res);
  } catch {
    return { status: 0, ok: false, message: "Network error" } as ApiResult<T>;
  }
}

let refreshing: Promise<boolean> | null = null;

/** Single in-flight refresh shared by all concurrent callers. */
function refreshOnce() {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Full-page navigation on purpose: the proxy re-evaluates fresh cookies and no router cache is reused. */
export function navigate(path: string) {
  window.location.assign(path);
}

export function redirectToLogin() {
  const here = window.location.pathname + window.location.search;
  navigate(`/login?next=${encodeURIComponent(here)}`);
}

/** fetch that, on 401, refreshes once and retries once; otherwise goes to /login. */
export async function fetchWithRefresh(input: RequestInfo | URL, init?: RequestInit) {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  if (await refreshOnce()) {
    const retry = await fetch(input, init);
    if (retry.status !== 401) return retry;
  }
  redirectToLogin();
  return res;
}

export async function postJsonWithRefresh<T = Record<string, unknown>>(path: string, body?: unknown) {
  const res = await fetchWithRefresh(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return parse<T>(res);
}

export async function deleteJsonWithRefresh<T = Record<string, unknown>>(path: string, body?: unknown) {
  const res = await fetchWithRefresh(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return parse<T>(res);
}
