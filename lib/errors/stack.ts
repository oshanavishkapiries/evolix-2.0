import type { ErrorFrame } from "@/db/schema";

// V8:              "    at fn (file:line:col)" | "    at file:line:col" | "    at async fn (file:line:col)"
// Firefox/Safari:  "fn@file:line:col" | "@file:line:col"
const V8 = /^\s*at (?:(?:async )?(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const GECKO = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;

/** Parses a JS stack string into frames, innermost first. Lines that are not frames are skipped. */
export function parseStack(stack: string | undefined | null): ErrorFrame[] {
  if (!stack) return [];
  const frames: ErrorFrame[] = [];
  for (const raw of stack.split("\n").slice(0, 80)) {
    const m = V8.exec(raw) ?? GECKO.exec(raw);
    if (!m) continue;
    const file = m[2].replace(/^\(/, "");
    frames.push({ fn: m[1]?.trim() || "<anonymous>", file, line: Number(m[3]), col: Number(m[4]), inApp: isInApp(file) });
  }
  return frames;
}

/** Our own code: source paths under the repo's app folders, never dependencies or framework internals. */
export function isInApp(file: string) {
  if (/node_modules|node:|\[turbopack\]|next\/dist|webpack-internal|<anonymous>|native/.test(file)) return false;
  return /(^|\/)(app|lib|db|proxy\.ts|instrumentation)/.test(normalizeSource(file));
}

/** "turbopack:///[project]/app/x.tsx" or "/srv/app/.next/../app/x.tsx" -> "app/x.tsx" where possible. */
export function normalizeSource(src: string) {
  let s = src.replace(/^turbopack:\/\/\/?/, "").replace(/^webpack:\/\/\/?(_N_E\/)?/, "").replace(/^file:\/\//, "");
  s = s.replace(/^\[project\]\//, "");
  const cwd = typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : "";
  if (cwd && s.startsWith(cwd + "/")) s = s.slice(cwd.length + 1);
  return s.replace(/^\.\//, "").replace(/\?.*$/, "");
}

/** Top in-app frame, else the top frame. */
export const culpritFrame = (frames: ErrorFrame[]) => frames.find((f) => f.inApp) ?? frames[0];

export const frameLabel = (f: ErrorFrame | undefined) => (f ? `${f.fn} (${f.file}${f.line ? `:${f.line}` : ""})` : "");
