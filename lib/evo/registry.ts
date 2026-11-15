import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { evoEngines, evoTasks } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/config/crypto";
import { engineIdFor, parseEngines, type EngineRef } from "@/lib/config/engine-list";
import { fetchEngine } from "./transport";

export class RegistryError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const generateToken = () => randomBytes(24).toString("hex");
export const maskedToken = maskSecret;
export function validateToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(value)) throw new RegistryError("Token must be 16–256 letters, digits, underscores or hyphens");
  return value;
}
export function validateEngineUrl(value: unknown): string {
  if (typeof value !== "string") throw new RegistryError("Engine URL is required");
  let u: URL;
  try { u = new URL(value); } catch { throw new RegistryError("Invalid engine URL"); }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new RegistryError("Use an HTTP(S) URL without credentials, query or fragment");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  // Link-local and cloud metadata services are never engines. LAN and localhost are intentional engine locations.
  if (/^169\.254\./.test(host) || /^(fe[89ab][0-9a-f]):/.test(host) || host.startsWith("::ffff:a9fe:") || host === "fd00:ec2::254" || host === "100.100.100.200" || host === "metadata.google.internal" || host === "metadata.goog") throw new RegistryError("Metadata and link-local addresses are not allowed");
  return u.toString().replace(/\/+$/, "");
}
function validateName(name: unknown): string {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) throw new RegistryError("Name must contain 1–100 characters");
  return name.trim();
}
type Row = typeof evoEngines.$inferSelect;
const ENGINE_CACHE_TTL_MS = 10_000;
let engineCache: { rows: Row[]; expires: number } | undefined;
let engineLoad: Promise<Row[]> | undefined;
let cacheGeneration = 0;

/** Also fences queries started before a mutation, so they cannot repopulate stale rows. */
export function invalidateEngineCache() {
  cacheGeneration += 1;
  engineCache = undefined;
  engineLoad = undefined;
}
function engineRows(): Promise<Row[]> {
  if (engineCache && engineCache.expires > Date.now()) return Promise.resolve(engineCache.rows);
  if (engineLoad) return engineLoad;
  const generation = cacheGeneration;
  const load = Promise.resolve(db.select().from(evoEngines)).then((rows) => {
    if (generation === cacheGeneration) engineCache = { rows, expires: Date.now() + ENGINE_CACHE_TTL_MS };
    return rows;
  }).finally(() => { if (engineLoad === load) engineLoad = undefined; });
  engineLoad = load;
  return load;
}
const refFor = (r: Row): EngineRef => ({ id: r.id, name: r.name ?? r.id, url: r.url });
export async function registeredEngines(): Promise<EngineRef[]> {
  const rows = await engineRows();
  const managed = rows.filter((r) => r.managed && !r.removedAt);
  if (managed.length) return managed.sort((a, b) => a.id.localeCompare(b.id)).map(refFor);
  const removed = new Set(rows.filter((r) => r.removedAt).map((r) => r.id));
  return parseEngines((await getConfig()).EVO_ENGINES).filter((r) => !removed.has(r.id));
}
/** Server only: Phase 4 uses this same token when deriving the config transport key. */
export async function engineCredential(id: string): Promise<{ token: string; cached: boolean }> {
  const cached = Boolean(engineLoad || (engineCache && engineCache.expires > Date.now()));
  const row = (await engineRows()).find((r) => r.id === id);
  if (row?.removedAt) throw new RegistryError("Engine has been removed", 404);
  return { token: row?.token ? decryptSecret(row.token) : (await getConfig()).EVO_SECRET_TOKEN, cached };
}
export async function engineToken(id: string): Promise<string> {
  return (await engineCredential(id)).token;
}
export async function listEngines() {
  const rows = await engineRows();
  const managed = rows.some((r) => r.managed && !r.removedAt);
  const refs = await registeredEngines();
  return { managed, engines: refs.map((ref) => {
    const row = rows.find((r) => r.id === ref.id);
    return { ...ref, managed: row?.managed ?? false, tokenMask: row?.token ? maskedToken(decryptSecret(row.token)) : null,
      draining: row?.draining ?? false, activeJobs: row?.activeJobs ?? 0, configVersion: row?.configVersion ?? 0, configPushedVersion: row?.configPushedVersion ?? 0 };
  }) };
}
async function rowFor(id: string) {
  const [row] = await db.select().from(evoEngines).where(and(eq(evoEngines.id, id), isNull(evoEngines.removedAt)));
  if (!row) throw new RegistryError("Engine not found", 404);
  return row;
}
function auditValue(row: { name: string | null; url: string; token: string | null } | null) {
  return row ? JSON.stringify({ name: row.name, url: row.url, token: row.token ? maskedToken(decryptSecret(row.token)) : null }) : null;
}
/** Neon HTTP: mutation + masked audit are one atomic statement. No secrets in SQL errors or audit values. */
async function audited(mutation: SQL, id: string, actor: string, key: string, before: string | null, after: string | null, remove = false) {
  try {
    const result = await db.execute(sql`with changed as (${mutation})
      insert into config_audit (key, scope, old_value, new_value, actor, action)
      select ${key}, ${`engine:${id}`}, ${before}, ${after}, ${actor}, ${remove ? "reset" : "set"} from changed returning id`);
    invalidateEngineCache();
    if (!result.rows.length) throw new RegistryError("Engine changed concurrently; reload and retry", 409);
  } catch (e) {
    if (e instanceof RegistryError) throw e;
    // Drizzle errors include SQL parameters (including the encrypted token). Never pass these to route logging.
    throw new RegistryError("Could not save engine; reload and check for a duplicate address", 409);
  }
}
export async function addEngine(input: { name: unknown; url: unknown; token?: unknown }, actor: string) {
  const name = validateName(input.name), url = validateEngineUrl(input.url), id = engineIdFor(url);
  const token = input.token === undefined ? generateToken() : validateToken(input.token);
  const rows = await db.select().from(evoEngines);
  const existing = rows.find((r) => r.id === id);
  if (rows.some((r) => r.id !== id && !r.removedAt && r.url === url)) throw new RegistryError("Engine address already exists", 409);
  if (existing?.managed && !existing.removedAt) throw new RegistryError("Engine address already exists", 409);
  const envelope = encryptSecret(token);
  await audited(sql`insert into evo_engines (id, url, name, token, managed) values (${id}, ${url}, ${name}, ${envelope}, true)
    on conflict (id) do update set name = excluded.name, url = excluded.url, token = excluded.token, managed = true, removed_at = null, updated_at = now()
    where evo_engines.managed = false or evo_engines.removed_at is not null returning id`, id, actor, "engine.add", auditValue(existing ?? null), JSON.stringify({ name, url, token: maskedToken(token) }));
  return { engine: { id, name, url, managed: true, tokenMask: maskedToken(token) }, token, envLine: `EVO_SECRET_TOKEN=${token}` };
}
export async function updateEngine(id: string, input: { name?: unknown; url?: unknown }, actor: string) {
  const row = await rowFor(id);
  const name = input.name === undefined ? row.name ?? id : validateName(input.name);
  const url = input.url === undefined ? row.url : validateEngineUrl(input.url);
  if (url !== row.url) {
    // Identity is the address; moving it would strand task history and per-engine overrides.
    // Keep the id stable for this existing record; new records still use engineIdFor.
    const duplicate = (await db.select().from(evoEngines)).some((r) => r.id !== id && !r.removedAt && (r.url === url || r.id === engineIdFor(url)));
    if (duplicate) throw new RegistryError("Engine address already exists", 409);
  }
  await audited(sql`update evo_engines set name = ${name}, url = ${url}, managed = true, updated_at = now()
    where id = ${id} and removed_at is null and token is not distinct from ${row.token} and name is not distinct from ${row.name} and url = ${row.url} returning id`, id, actor, "engine.update", auditValue(row), auditValue({ ...row, name, url }));
  return { id, name, url };
}
export async function rotateEngineToken(id: string, actor: string) {
  const row = await rowFor(id), token = generateToken(), envelope = encryptSecret(token);
  await audited(sql`update evo_engines set token = ${envelope}, managed = true, updated_at = now()
    where id = ${id} and removed_at is null and token is not distinct from ${row.token} and name is not distinct from ${row.name} and url = ${row.url} returning id`, id, actor, "engine.rotate-token", row.token ? maskedToken(decryptSecret(row.token)) : null, maskedToken(token));
  return { id, token, envLine: `EVO_SECRET_TOKEN=${token}` };
}
const ACTIVE = new Set(["PENDING", "EXTRACTING", "STREAMING", "DOWNLOADING", "UPLOADING"]);
export async function removeEngine(id: string, actor: string, force = false) {
  const row = await rowFor(id);
  if (!force) {
    if (!row.draining) throw new RegistryError("Drain this engine before removing it, or confirm force removal", 409);
    const token = await engineToken(id);
    try {
      const queueResponse = await fetchEngine(row.url, "/queue", token, { timeoutMs: 3000 });
      if (!queueResponse.ok) throw new Error();
      const queue = await queueResponse.json() as { waiting_extraction?: number; extracting?: number; caching?: number };
      if (row.activeJobs > 0 || row.queueDepth > 0 || [queue.waiting_extraction, queue.extracting, queue.caching].some((n) => n === undefined || n > 0)) throw new RegistryError("Engine still has active or queued jobs; force removal requires confirmation", 409);
      const owned = await db.select().from(evoTasks).where(eq(evoTasks.engineId, id));
      for (const task of owned) {
        const res = await fetchEngine(row.url, `/status/${encodeURIComponent(task.taskId)}`, token, { timeoutMs: 3000 });
        if (res.status === 404) continue;
        if (!res.ok) throw new Error();
        const status = (await res.json() as { status?: string }).status;
        if (!status) throw new Error();
        if (ACTIVE.has(status)) throw new RegistryError("Engine owns in-flight tasks; force removal requires confirmation", 409);
      }
    } catch (e) {
      if (e instanceof RegistryError) throw e;
      throw new RegistryError("Cannot confirm this engine is empty while unreachable; force removal requires confirmation", 409);
    }
  }
  await audited(sql`update evo_engines set removed_at = now(), token = null, managed = false, updated_at = now()
    where id = ${id} and removed_at is null and token is not distinct from ${row.token} and name is not distinct from ${row.name} and url = ${row.url}
    and (${force} or (draining = true and active_jobs = 0 and queue_depth = 0)) returning id`, id, actor, "engine.remove", auditValue(row), null, true);
  return { id, removed: true };
}
export async function testEngineConnection(input: { url: unknown; token: unknown }) {
  const url = validateEngineUrl(input.url), token = validateToken(input.token), start = Date.now();
  try {
    const response = await fetchEngine(url, "/queue", token, { timeoutMs: 5000 });
    const data = await response.json().catch(() => ({})) as { version?: unknown };
    return { reachable: true, authOk: response.ok, latency: Date.now() - start, version: typeof data.version === "string" ? data.version : null };
  } catch { return { reachable: false, authOk: false, latency: Date.now() - start, version: null }; }
}

/** Effective inbound credentials: removed engines and superseded global credentials cannot authenticate. */
export async function engineCallbackTokens(): Promise<string[]> {
  const rows = await db.select({ token: evoEngines.token }).from(evoEngines).where(and(eq(evoEngines.managed, true), isNull(evoEngines.removedAt)));
  const tokens = rows.flatMap((r) => r.token ? [decryptSecret(r.token)] : []);
  if (!rows.length || rows.some((r) => !r.token)) tokens.push((await getConfig()).EVO_SECRET_TOKEN);
  return tokens.filter(Boolean);
}
