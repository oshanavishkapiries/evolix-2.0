import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { evoClaims, evoEngines, evoSubtitleOwners, evoTasks } from "@/db/schema";
import { defaultEngine, engineById, engineFetch, engines, type EngineRef } from "./client";

/**
 * The app is the gateway and scheduler for its engines. Health snapshots, drain switches, job claims and task
 * ownership live in the app's own database, so any number of app instances agree without a separate gateway.
 */

/** Engines are re-checked when their last check is older than this; also bounds how long a dead engine can still be picked. */
export const HEALTH_TTL_MS = 10_000;
const CHECK_TIMEOUT_MS = 3_000;
const ACTIVE = new Set(["PENDING", "EXTRACTING", "STREAMING", "DOWNLOADING", "UPLOADING"]);

export class NoEngineAvailableError extends Error {
  constructor(message = "No Evo engine is available right now") {
    super(message);
  }
}

export type EngineRow = typeof evoEngines.$inferSelect;

// ---------------------------------------------------------------- health

type Health = { status: string; free_disk_gb?: number };
type Queue = { paused: boolean; waiting_extraction: number; extracting: number; caching: number; max_extractions?: number };

async function check(engine: EngineRef) {
  const [h, q] = await Promise.all([
    engineFetch("/health", { engine, timeoutMs: CHECK_TIMEOUT_MS }),
    engineFetch("/queue", { engine, timeoutMs: CHECK_TIMEOUT_MS }),
  ]);
  if (!h.ok) throw new Error(`health returned ${h.status}`);
  const health = (await h.json()) as Health;
  const queue = q.ok ? ((await q.json()) as Queue) : null;
  return { health, queue };
}

async function ensureRows() {
  await db
    .insert(evoEngines)
    .values(engines().map((e) => ({ id: e.id, url: e.url })))
    .onConflictDoUpdate({ target: evoEngines.id, set: { url: sql`excluded.url` } });
}

let refreshing: Promise<void> | null = null;
let checkedOnce = false;

/** Checks every configured engine whose snapshot is stale (or all of them when forced). One check at a time per process. */
export function refreshHealth(force = false): Promise<void> {
  // The first look after a start never trusts numbers saved by an earlier process.
  const first = !checkedOnce;
  checkedOnce = true;
  refreshing ??= doRefresh(force || first).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function doRefresh(force: boolean) {
  await ensureRows();
  const rows = await db.select().from(evoEngines).where(inArray(evoEngines.id, engines().map((e) => e.id)));
  const now = Date.now();
  const stale = engines().filter((e) => {
    const r = rows.find((x) => x.id === e.id);
    return force || !r?.lastCheckedAt || now - r.lastCheckedAt.getTime() > HEALTH_TTL_MS;
  });
  await Promise.all(
    stale.map(async (engine) => {
      const at = new Date();
      try {
        const { health, queue } = await check(engine);
        await db
          .update(evoEngines)
          .set({
            healthy: true,
            lastCheckedAt: at,
            lastOkAt: at,
            lastError: null,
            activeJobs: queue ? queue.extracting + queue.caching : 0,
            queueDepth: queue?.waiting_extraction ?? 0,
            maxExtractions: Math.max(1, queue?.max_extractions ?? 1),
            freeDiskGb: health.free_disk_gb ?? null,
            updatedAt: at,
          })
          .where(eq(evoEngines.id, engine.id));
      } catch (e) {
        await db
          .update(evoEngines)
          .set({ healthy: false, lastCheckedAt: at, lastError: e instanceof Error ? e.message.slice(0, 300) : "unreachable", updatedAt: at })
          .where(eq(evoEngines.id, engine.id));
      }
    }),
  );
}

/** Current snapshot of every configured engine (after a health refresh unless `fresh` is false). */
export async function engineRows(fresh = true): Promise<(EngineRow & { ref: EngineRef })[]> {
  if (fresh) await refreshHealth();
  else await ensureRows();
  const rows = await db.select().from(evoEngines).where(inArray(evoEngines.id, engines().map((e) => e.id)));
  return engines().flatMap((ref) => {
    const row = rows.find((r) => r.id === ref.id);
    return row ? [{ ...row, ref }] : [];
  });
}

/** A call just failed to reach the engine: stop sending it new jobs now instead of waiting for the next health check. */
export async function markUnhealthy(engine: EngineRef, reason: string) {
  if (engines().length === 1) return;
  await db.update(evoEngines).set({ healthy: false, lastError: reason.slice(0, 300), lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(evoEngines.id, engine.id));
}

export async function setDraining(id: string, draining: boolean) {
  if (!engineById(id)) return false;
  await ensureRows();
  await db.update(evoEngines).set({ draining, updatedAt: new Date() }).where(eq(evoEngines.id, id));
  return true;
}

// ---------------------------------------------------------------- choosing an engine

const eligible = (r: EngineRow) => r.healthy && !r.draining;
const load = (r: EngineRow) => (r.activeJobs + r.queueDepth) / Math.max(1, r.maxExtractions);

/** Healthy, non-draining engine with the most spare capacity (queue depth relative to its parallelism); disk breaks ties. */
export async function pickEngine(prefer?: string, exclude?: string): Promise<EngineRef> {
  const rows = (await engineRows()).filter((r) => eligible(r) && r.id !== exclude);
  if (!rows.length) throw new NoEngineAvailableError();
  rows.sort((a, b) => load(a) - load(b) || (b.freeDiskGb ?? 0) - (a.freeDiskGb ?? 0));
  // Another quality of the same title goes where the first one went (it can reuse that engine's extraction), unless it is clearly busier.
  const preferred = prefer ? rows.find((r) => r.id === prefer) : undefined;
  const best = preferred && load(preferred) <= load(rows[0]) + 1 ? preferred : rows[0];
  return best.ref;
}

/** A job we just placed is not in the engine's own numbers until its next check: count it now so a burst spreads out. */
const bump = (engine: EngineRef) =>
  db.update(evoEngines).set({ queueDepth: sql`${evoEngines.queueDepth} + 1` }).where(eq(evoEngines.id, engine.id));

// ---------------------------------------------------------------- claims

/**
 * The engine a job identity (`key`) belongs to. The first request claims one atomically; every other request,
 * from any app instance, gets the same answer, and the engine itself joins duplicates, so one job exists on one engine.
 * A claim whose engine is down (or draining with nothing left to finish) is moved to a healthy engine: that
 * request becomes a controlled retry, and the old task stays with its old engine.
 *
 * With a single engine there is nothing to decide and no database round trip.
 */
export async function claimEngine(key: string, opts: { affinityPrefix?: string; avoid?: string } = {}): Promise<EngineRef> {
  if (engines().length === 1) {
    if (opts.avoid) throw new NoEngineAvailableError("There is no other engine to move this job to");
    return defaultEngine();
  }
  await refreshHealth();
  for (let attempt = 0; attempt < 4; attempt++) {
    const [claim] = await db.select().from(evoClaims).where(eq(evoClaims.key, key)).limit(1);
    if (claim) {
      const ref = engineById(claim.engineId);
      const [row] = ref ? await db.select().from(evoEngines).where(eq(evoEngines.id, ref.id)).limit(1) : [];
      const asked = opts.avoid !== undefined && claim.engineId === opts.avoid; // an admin wants it off this engine
      if (!asked && ref && row?.healthy && !row.draining) return ref;
      if (!asked && ref && row?.healthy && row.draining && (await jobActive(ref, claim.taskId))) return ref; // let it finish
      const to = await pickEngine(undefined, opts.avoid);
      const moved = await db
        .update(evoClaims)
        .set({ engineId: to.id, taskId: null, updatedAt: new Date() })
        .where(and(eq(evoClaims.key, key), eq(evoClaims.engineId, claim.engineId)))
        .returning({ key: evoClaims.key });
      if (moved.length) {
        await bump(to);
        return to;
      }
      continue; // someone else moved it first: read their choice
    }
    let prefer: string | undefined;
    if (opts.affinityPrefix) {
      const [sibling] = await db.select({ engineId: evoClaims.engineId }).from(evoClaims).where(like(evoClaims.key, `${opts.affinityPrefix}%`)).limit(1);
      prefer = sibling?.engineId;
    }
    const to = await pickEngine(prefer, opts.avoid);
    const inserted = await db.insert(evoClaims).values({ key, engineId: to.id }).onConflictDoNothing().returning({ key: evoClaims.key });
    if (inserted.length) {
      await bump(to);
      return to;
    }
  }
  throw new NoEngineAvailableError("Could not settle which engine handles this job");
}

async function jobActive(engine: EngineRef, taskId: string | null) {
  if (!taskId) return false;
  try {
    const res = await engineFetch(`/status/${taskId}`, { engine, timeoutMs: CHECK_TIMEOUT_MS });
    return res.ok && ACTIVE.has(((await res.json()) as { status?: string }).status ?? "");
  } catch {
    return false;
  }
}

export const ingestKey = (mediaType: string, tmdbId: number, season: number | undefined, episode: number | undefined, quality: string) =>
  `ingest:${mediaType}:${tmdbId}:${season ?? 0}:${episode ?? 0}:${quality}`;
export const ingestAffinity = (mediaType: string, tmdbId: number, season: number | undefined, episode: number | undefined) =>
  `ingest:${mediaType}:${tmdbId}:${season ?? 0}:${episode ?? 0}:`;
export const sinhalaKey = (mediaType: string, tmdbId: number, season: number | undefined, episode: number | undefined, sourceTrackId?: string) =>
  `sinhala:${mediaType}:${tmdbId}:${season ?? 0}:${episode ?? 0}${sourceTrackId ? `:${sourceTrackId}` : ""}`;

/** Remembers which engine owns a task (and which task fulfils a claim). Ownership never changes afterwards. */
export async function recordTask(taskId: string, engine: EngineRef, kind: "ingest" | "sinhala", claimKey?: string) {
  await db.insert(evoTasks).values({ taskId, engineId: engine.id, kind, claimKey }).onConflictDoNothing();
  owners.set(taskId, engine.id);
  if (claimKey) await db.update(evoClaims).set({ taskId, updatedAt: new Date() }).where(and(eq(evoClaims.key, claimKey), eq(evoClaims.engineId, engine.id)));
}

// ---------------------------------------------------------------- routing

/** Task ownership never changes, so lookups are cached (the stream route asks on every segment). */
const owners = new Map<string, string>();
const MAX_CACHED = 5000;

export class EngineGoneError extends Error {
  constructor(public engineId: string) {
    super(`The engine that owns this task (${engineId}) is no longer configured`);
  }
}

/** Engine that owns a task; tasks from before multi-engine belong to the primary engine. */
export async function engineForTask(taskId: string): Promise<EngineRef> {
  if (engines().length === 1) return defaultEngine();
  let id = owners.get(taskId);
  if (!id) {
    const [row] = await db.select({ engineId: evoTasks.engineId }).from(evoTasks).where(eq(evoTasks.taskId, taskId)).limit(1);
    id = row?.engineId ?? defaultEngine().id;
    if (owners.size >= MAX_CACHED) owners.clear();
    owners.set(taskId, id);
  }
  const ref = engineById(id);
  if (!ref) throw new EngineGoneError(id);
  return ref;
}

/** Engine id recorded for a task, or null when unknown (a single-engine deployment, or an old task). */
export async function engineIdOfTask(taskId: string | undefined): Promise<string | null> {
  if (!taskId) return null;
  if (engines().length === 1) return defaultEngine().id;
  const [row] = await db.select({ engineId: evoTasks.engineId }).from(evoTasks).where(eq(evoTasks.taskId, taskId)).limit(1);
  return row?.engineId ?? null;
}

/** Owning engine of many tasks at once (admin lists). Unknown tasks map to the primary engine. */
export async function ownersOf(taskIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (taskIds.length) {
    for (const r of await db.select({ taskId: evoTasks.taskId, engineId: evoTasks.engineId }).from(evoTasks).where(inArray(evoTasks.taskId, taskIds))) out.set(r.taskId, r.engineId);
  }
  return out;
}

export async function recordSubtitleOwners(engine: EngineRef, subs: unknown) {
  if (engines().length === 1 || !Array.isArray(subs)) return;
  const ids = subs.map((s) => (s as { id?: unknown })?.id).filter((v): v is string => typeof v === "string");
  if (ids.length) await db.insert(evoSubtitleOwners).values(ids.map((subId) => ({ subId, engineId: engine.id }))).onConflictDoNothing();
}

/** Engine holding a subtitle id; unknown ids are looked up on each engine in turn by the caller. */
export async function subtitleOwner(subId: string): Promise<EngineRef | null> {
  if (engines().length === 1) return defaultEngine();
  const [row] = await db.select({ engineId: evoSubtitleOwners.engineId }).from(evoSubtitleOwners).where(eq(evoSubtitleOwners.subId, subId)).limit(1);
  return (row && engineById(row.engineId)) || null;
}

/** Engine behind a claim key (Sinhala polling), or null when nothing claimed it. */
export async function claimedEngine(key: string): Promise<EngineRef | null> {
  if (engines().length === 1) return defaultEngine();
  const [row] = await db.select({ engineId: evoClaims.engineId }).from(evoClaims).where(eq(evoClaims.key, key)).limit(1);
  return (row && engineById(row.engineId)) || null;
}
