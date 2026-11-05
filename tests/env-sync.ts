/** Keep .env.example aligned with all main-app settings, including admin fallbacks. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";
import { configRegistry, validateConfigValue } from "../lib/config/registry";

const root = join(__dirname, "..");
const RUNTIME = new Set(["NODE_ENV", "NEXT_RUNTIME"]);
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith(".d.ts") ? [p] : [];
  });
}
const used = new Set<string>(configRegistry.map((entry) => entry.key));
const files = ["app", "lib", "db"].flatMap((dir) => sources(join(root, dir)));
files.push(join(root, "next.config.ts"), join(root, "instrumentation.ts"), join(root, "proxy.ts"));
for (const file of files) {
  for (const m of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
}
for (const k of RUNTIME) used.delete(k);
const example = readFileSync(join(root, ".env.example"), "utf8");
const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
const missing = [...used].filter((k) => !documented.has(k));
const unused = [...documented].filter((k) => !used.has(k));
if (missing.length) console.error("Settings missing from .env.example:", missing.join(", "));
if (unused.length) console.error("Unknown settings in .env.example:", unused.join(", "));
if (missing.length || unused.length) process.exit(1);
const values = parse(example);
for (const entry of configRegistry) {
  // Required credentials are intentionally blank; documented defaults must validate.
  if (entry.default !== undefined) {
    const actual = validateConfigValue(entry.key, values[entry.key]);
    if (actual !== entry.default) throw new Error(`Default mismatch for ${entry.key}`);
  }
}
console.log(`ok: ${documented.size} main-app settings, .env.example in sync`);
