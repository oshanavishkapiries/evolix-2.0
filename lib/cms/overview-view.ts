/** How the admin overview reads its numbers (pure, unit tested). */

export type Tone = "ok" | "warn" | "bad";

/** The last `size` days against the `size` before them; `avg` averages instead of summing (for per-day counts like viewers). */
export function compareWindows(values: number[], size = 7, avg = false) {
  const cur = values.slice(-size);
  const prev = values.slice(-size * 2, -size);
  const total = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / (avg ? xs.length : 1) : 0);
  const now = total(cur);
  const before = total(prev);
  return { now, before, change: before ? ((now - before) / before) * 100 : null };
}

export function errorTone(e: { open: number; new24: number } | null): Tone {
  if (!e) return "warn";
  return e.new24 > 0 ? "bad" : e.open > 0 ? "warn" : "ok";
}

export function reportTone(r: { open: number; new24: number }): Tone {
  return r.new24 > 0 ? "bad" : r.open > 0 ? "warn" : "ok";
}

export function engineTone(up: number, total: number): Tone {
  return up === 0 ? "bad" : up < total ? "warn" : "ok";
}
