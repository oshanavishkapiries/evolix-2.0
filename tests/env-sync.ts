/** Fails when `.env.example` drifts from the bootstrap set or lists a variable the app never reads. Run: pnpm test:env */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { configRegistry } from "../lib/config/registry";

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

const used = new Set<string>(configRegistry.map((entry) => entry.key));
for (const file of sources(root)) {
  for (const m of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
}
for (const k of RUNTIME) used.delete(k);

const documented = new Set(
  [...readFileSync(join(root, ".env.example"), "utf8").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]),
);

// The example lists bootstrap variables only; every registry key is managed in the admin panel.
const BOOTSTRAP = ["DATABASE_URL", "CONFIG_ENCRYPTION_KEY"];
const FIRST_DEPLOY = ["ADMIN_EMAILS", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "TMDB_API_KEY"];
const missing = [...BOOTSTRAP, ...FIRST_DEPLOY].filter((k) => !documented.has(k));
const extra = [...documented].filter((k) => !BOOTSTRAP.includes(k) && !FIRST_DEPLOY.includes(k));
const unused = [...documented].filter((k) => !used.has(k));
if (missing.length) console.error("Bootstrap variables missing from .env.example:", missing.join(", "));
if (extra.length) console.error("Non-bootstrap variables in .env.example (manage in admin):", extra.join(", "));
if (unused.length) console.error("In .env.example but never read by the app:", unused.join(", "));
if (missing.length || extra.length || unused.length) process.exit(1);
console.log(`ok: ${documented.size} bootstrap variables, .env.example in sync`);
