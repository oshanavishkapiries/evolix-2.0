const SECRET_HEADERS = new Set(["cookie", "authorization", "set-cookie", "x-evo-secret", "proxy-authorization"]);
const KEEP_HEADERS = new Set(["user-agent", "referer", "accept-language", "host", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "content-type", "next-router-state-tree", "rsc", "next-action"]);

/** Request headers worth keeping on an event, with credentials removed. */
export function scrubHeaders(h: Record<string, string | string[] | undefined> | Headers | undefined) {
  const out: Record<string, string> = {};
  if (!h) return out;
  const entries = h instanceof Headers ? [...h.entries()] : Object.entries(h);
  for (const [k, v] of entries) {
    const key = k.toLowerCase();
    if (SECRET_HEADERS.has(key) || !KEEP_HEADERS.has(key) || v === undefined) continue;
    out[key] = (Array.isArray(v) ? v.join(", ") : v).slice(0, 500);
  }
  return out;
}

/** Removes tokens and password-looking values from free text (messages, URLs, breadcrumbs). */
export function scrubText(s: string) {
  return s
    .replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[jwt]")
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi, "$1 [redacted]")
    .replace(/\b(sk|pk|ghp|gho|npg)[-_][\w-]{10,}/g, "[key]")
    .replace(/((?:pass(?:word)?|pwd|secret|token|otp|code|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, "$1[redacted]");
}
