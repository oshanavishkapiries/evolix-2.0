/** Returns `next` only when it is a same-origin relative path, else `fallback`. */
export function safeNext(next: string | null | undefined, fallback = "/dashboard") {
  if (!next || next.length > 2048) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  // Reject control characters and anything that resolves off-origin.
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = "http://localhost";
    if (new URL(next, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
