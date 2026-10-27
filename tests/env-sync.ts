/** Fails when `.env.example` and the variables the app reads drift apart. Run: pnpm test:env */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const SKIP = new Set(["node_modules", ".next", "evo-engine", "tests", ".git", "drizzle"]);

// NODE_ENV is set by the runtime, not configured by hand.
const RUNTIME = new Set(["NODE_ENV", "NEXT_RUNTIME"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith(".d.ts") ? [p] : [];
  });
}

const schema = readFileSync(join(root, "lib/env.ts"), "utf8");
const body = schema.slice(schema.indexOf("z.object({"), schema.indexOf("});"));
const used = new Set([...body.matchAll(/^\s+([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]));
for (const file of sources(root)) {
  for (const m of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
}
for (const k of RUNTIME) used.delete(k);

const documented = new Set(
  [...readFileSync(join(root, ".env.example"), "utf8").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]),
);

const undocumented = [...used].filter((k) => !documented.has(k));
const unused = [...documented].filter((k) => !used.has(k));
if (undocumented.length) console.error("Read by the app but missing from .env.example:", undocumented.join(", "));
if (unused.length) console.error("In .env.example but never read by the app:", unused.join(", "));
if (undocumented.length || unused.length) process.exit(1);
console.log(`ok: ${used.size} variables, .env.example in sync`);
