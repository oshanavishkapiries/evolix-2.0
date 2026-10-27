// Browser error reporting: breadcrumbs plus a beacon to /api/errors. State lives on globalThis so the
// instrumentation bundle and the app bundle share it even if each gets its own copy of this module.

type Crumb = { t: number; type: "nav" | "click" | "fetch" | "console" | "log"; message: string; level?: "info" | "warning" | "error" };
type State = { crumbs: Crumb[]; sent: number; recent: Map<string, number>; installed: boolean };

const MAX_CRUMBS = 40;
const MAX_REPORTS = 25;
const ENDPOINT = "/api/errors";

const state = (): State => {
  const g = globalThis as typeof globalThis & { __evolixErrors?: State };
  return (g.__evolixErrors ??= { crumbs: [], sent: 0, recent: new Map(), installed: false });
};

export function addBreadcrumb(type: Crumb["type"], message: string, level: Crumb["level"] = "info") {
  const s = state();
  s.crumbs.push({ t: Date.now(), type, message: message.slice(0, 300), level });
  if (s.crumbs.length > MAX_CRUMBS) s.crumbs.shift();
}

// Noise from browsers and extensions, not from our code.
const IGNORE = [/ResizeObserver loop/, /^Script error\.?$/, /Non-Error promise rejection captured/, /AbortError/, /The operation was aborted/, /Load failed$/, /chrome-extension:|moz-extension:|safari-extension:/];

export function reportError(error: unknown, extra: { mechanism: string; componentStack?: string; level?: "error" | "warning" | "fatal" }) {
  try {
    const s = state();
    const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : safe(error));
    const message = err.message || String(error);
    if (IGNORE.some((r) => r.test(message) || r.test(err.stack ?? ""))) return;
    // Errors from Server Components arrive with only a digest; the server already recorded the real one.
    if ((err as { digest?: string }).digest) return;
    const key = `${err.name}:${message}:${(err.stack ?? "").split("\n")[1] ?? ""}`;
    const now = Date.now();
    if ((s.recent.get(key) ?? 0) > now - 5000 || s.sent >= MAX_REPORTS) return;
    s.recent.set(key, now);
    s.sent++;
    const body = JSON.stringify({
      type: err.name || "Error",
      message,
      stack: err.stack ?? "",
      level: extra.level ?? "error",
      url: location.href,
      breadcrumbs: s.crumbs,
      context: {
        mechanism: extra.mechanism,
        componentStack: extra.componentStack?.slice(0, 4000),
        viewport: `${innerWidth}x${innerHeight}`,
        language: navigator.language,
        online: navigator.onLine,
        standalone: matchMedia("(display-mode: standalone)").matches,
        referrer: document.referrer || undefined,
      },
    });
    void fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 60_000, credentials: "same-origin" }).catch(() => {});
  } catch {
    // Reporting must never break the page.
  }
}

function safe(v: unknown) {
  try {
    return JSON.stringify(v)?.slice(0, 500) ?? String(v);
  } catch {
    return String(v);
  }
}

function describeTarget(el: Element | null) {
  if (!el) return "";
  const target = el.closest("button, a, [role=button], input, select, summary, label") ?? el;
  const id = target.id ? `#${target.id}` : "";
  const text = (target.getAttribute("aria-label") || (target as HTMLElement).innerText || "").trim().replace(/\s+/g, " ").slice(0, 40);
  return `${target.tagName.toLowerCase()}${id}${text ? ` "${text}"` : ""}`;
}

/** Installs the global handlers once. */
export function installErrorReporting() {
  const s = state();
  if (s.installed || typeof window === "undefined") return;
  s.installed = true;

  window.addEventListener("error", (e) => {
    // Resource load failures (img/script) have no error object; keep them as breadcrumbs.
    if (!e.error && e.target && e.target !== window) {
      const t = e.target as HTMLElement & { src?: string; href?: string };
      addBreadcrumb("log", `Failed to load ${t.tagName?.toLowerCase()} ${t.src || t.href || ""}`, "warning");
      return;
    }
    reportError(e.error ?? e.message, { mechanism: "window.onerror" });
  }, true);
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, { mechanism: "unhandledrejection" }));

  document.addEventListener("click", (e) => addBreadcrumb("click", describeTarget(e.target as Element)), { capture: true, passive: true });

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes(ENDPOINT)) return origFetch(input, init);
    const started = performance.now();
    try {
      const res = await origFetch(input, init);
      if (!res.ok) addBreadcrumb("fetch", `${method} ${shortUrl(url)} -> ${res.status} (${Math.round(performance.now() - started)} ms)`, res.status >= 500 ? "error" : "warning");
      return res;
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) addBreadcrumb("fetch", `${method} ${shortUrl(url)} -> network error`, "error");
      throw err;
    }
  };

  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    addBreadcrumb("console", args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : safe(a))).join(" "), "error");
    origError(...args);
  };

  addBreadcrumb("nav", `Loaded ${location.pathname}${location.search}`);
}

function shortUrl(u: string) {
  try {
    const x = new URL(u, location.href);
    return x.origin === location.origin ? x.pathname + x.search : x.origin + x.pathname;
  } catch {
    return u;
  }
}
