import "server-only";
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { SourceMapConsumer, type RawSourceMap } from "source-map-js";
import type { ErrorFrame } from "@/db/schema";
import { isInApp, normalizeSource } from "./stack";

const CONTEXT = 5;
const ROOT = process.cwd();
const NEXT = path.join(/*turbopackIgnore: true*/ ROOT, ".next");

// Small LRU of parsed maps: parsing a chunk map costs a few ms, errors tend to repeat.
const cache = new Map<string, { mtime: number; map: SourceMapConsumer } | null>();
function consumer(file: string) {
  let mtime = 0;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.map;
  let map: SourceMapConsumer | null = null;
  try {
    map = new SourceMapConsumer(JSON.parse(readFileSync(file, "utf8")) as RawSourceMap);
  } catch {
    map = null;
  }
  cache.set(file, map ? { mtime, map } : null);
  if (cache.size > 40) cache.delete(cache.keys().next().value!);
  return map;
}

/** Local .map for a frame's file: browser chunks by URL path, server chunks by absolute path. */
function mapFileFor(file: string): string | null {
  let local: string | null = null;
  const at = file.indexOf("/_next/static/");
  if (at >= 0) local = path.join(/*turbopackIgnore: true*/ NEXT, "static", file.slice(at + "/_next/static/".length).replace(/[?#].*$/, ""));
  else if (file.startsWith(NEXT)) local = file;
  else if (file.startsWith("file://")) local = file.slice(7);
  if (!local) return null;
  local = path.normalize(local);
  // Never read outside the build folder, whatever the (client supplied) URL says.
  if (!local.startsWith(NEXT + path.sep)) return null;
  if (mapNames.has(local)) return mapNames.get(local)!;
  // Turbopack names a chunk's map in its trailing comment; the name differs from the chunk's.
  let map: string | null = null;
  try {
    const tail = readTail(local);
    const enc = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(tail)?.[1];
    const name = enc && !enc.startsWith("data:") ? decodeURIComponent(enc) : enc;
    const candidate = name && !name.startsWith("data:") ? path.normalize(path.join(/*turbopackIgnore: true*/ path.dirname(local), name)) : `${local}.map`;
    if (candidate.startsWith(NEXT + path.sep) && existsSync(candidate)) map = candidate;
  } catch {}
  mapNames.set(local, map);
  if (mapNames.size > 500) mapNames.delete(mapNames.keys().next().value!);
  return map;
}

const mapNames = new Map<string, string | null>();

function readTail(file: string) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, 512);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Source lines around `line` (1-based): from the map's embedded sources, or the repo file for server code. */
function contextFor(source: string, line: number, map: SourceMapConsumer | null) {
  let text: string | null = null;
  if (map) {
    try {
      text = map.sourceContentFor(source, true);
    } catch {
      text = null;
    }
  }
  if (!text) {
    const local = path.normalize(path.join(/*turbopackIgnore: true*/ ROOT, normalizeSource(source)));
    if (local.startsWith(ROOT + path.sep) && !local.includes(`${path.sep}node_modules${path.sep}`) && !local.startsWith(path.join(ROOT, ".env"))) {
      try {
        if (statSync(local).size < 2_000_000) text = readFileSync(local, "utf8");
      } catch {}
    }
  }
  if (!text) return undefined;
  const lines = text.split("\n");
  const start = Math.max(1, line - CONTEXT);
  return { start, lines: lines.slice(start - 1, line + CONTEXT).map((l) => l.slice(0, 300)) };
}

/** Maps minified/bundled positions back to original files, and attaches source context to in-app frames. */
export function symbolicate(frames: ErrorFrame[]): ErrorFrame[] {
  return frames.map((f) => {
    try {
      let out = f;
      const mapFile = f.line ? mapFileFor(f.file) : null;
      const map = mapFile ? consumer(mapFile) : null;
      if (map && f.line) {
        const pos = map.originalPositionFor({ line: f.line, column: Math.max(0, (f.col ?? 1) - 1) });
        if (pos.source && pos.line) {
          // Server maps list sources relative to the map file ("../../../lib/x.ts").
          const file = normalizeSource(pos.source.startsWith(".") ? path.resolve(/*turbopackIgnore: true*/ path.dirname(mapFile!), pos.source) : pos.source);
          out = { fn: pos.name || f.fn, file, line: pos.line, col: (pos.column ?? 0) + 1, inApp: isInApp(file) };
          if (out.inApp) out.context = contextFor(pos.source, pos.line, map);
          return out;
        }
      }
      const file = normalizeSource(f.file);
      out = { ...f, file, inApp: isInApp(file) };
      if (out.inApp && out.line) out.context = contextFor(file, out.line, null);
      return out;
    } catch {
      return f;
    }
  });
}
