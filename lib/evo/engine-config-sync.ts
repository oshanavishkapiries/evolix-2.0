import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { engineConfigSync, evoEngines } from "@/db/schema";
import { engineToken, registeredEngines, invalidateEngineCache } from "./registry";
import { fetchEngine } from "./transport";
import { buildPushPayload, configRows, effectiveEngineConfig, EngineConfigError } from "./engine-config-store";
import { ENGINE_CONFIG_BY_KEY, type ConfigSyncStatus } from "./engine-config";
export type ReportedConfig = { config_version?:number; config_managed?:boolean; restart_needed?:string[] };
const restartKeys = (keys:unknown):string[] => Array.isArray(keys) ? keys.filter((k):k is string=>typeof k === "string" && ENGINE_CONFIG_BY_KEY.has(k)) : [];
async function record(id:string,version:number,state:ConfigSyncStatus["state"],error:string|null,restart:unknown=[]) {
  // A response for an older save must never clear a newer pending configuration.
  await db.execute(sql`with current as (
    select id from evo_engines where id=${id} and removed_at is null and config_version=${version} for update
  ), recorded as (
    insert into engine_config_sync (engine_id,state,last_error,last_attempt_at,restart_needed)
    select id,${state},${error},now(),${JSON.stringify(restartKeys(restart))}::jsonb from current
    on conflict (engine_id) do update set state=excluded.state,last_error=excluded.last_error,last_attempt_at=excluded.last_attempt_at,restart_needed=excluded.restart_needed returning engine_id
  ) update evo_engines set config_pushed_version=${version} where id in (select engine_id from recorded) and ${state}='in_sync'`);
  invalidateEngineCache();
}
const pushing = new Map<string,Promise<void>>();
export function pushEngineConfig(id:string,force=false):Promise<void> {
  const active = pushing.get(id); if (active) return active;
  const work = push(id,force).finally(()=>pushing.delete(id)); pushing.set(id,work); return work;
}
async function push(id:string,force:boolean) {
  const ref = (await registeredEngines()).find(e=>e.id === id);
  if (!ref) throw new EngineConfigError("Engine not found",404);
  for (let attempt=0;attempt<2;attempt++) {
    const [row] = await db.select().from(evoEngines).where(and(eq(evoEngines.id,id),isNull(evoEngines.removedAt)));
    const rows = await configRows(id);
    if (!row || (!rows.length && row.configVersion === 0)) return;
    const [sync] = await db.select().from(engineConfigSync).where(eq(engineConfigSync.engineId,id));
    if (!force && (sync?.state === "too_old" || sync?.state === "rejected")) return;
    // A newly registered engine can inherit global rows created before it existed.
    if (row.configVersion === 0) {
      await db.update(evoEngines).set({configVersion:1}).where(and(eq(evoEngines.id,id),eq(evoEngines.configVersion,0),isNull(evoEngines.removedAt)));
      invalidateEngineCache();
    }
    const version = row.configVersion || 1, config = effectiveEngineConfig(rows,id), token = await engineToken(id);
    try {
      const response = await fetchEngine(ref.url,"/config/push",token,{method:"PUT",body:buildPushPayload(version,config,token),timeoutMs:5000});
      const body = await response.json().catch(()=>({})) as {version?:unknown;managed?:unknown;restart_needed?:unknown;detail?:unknown};
      if (response.ok && body.version === version && body.managed === true) { await record(id,version,"in_sync",null,body.restart_needed); return; }
      if (response.status === 409 && attempt === 0 && typeof body.version === "number" && Number.isSafeInteger(body.version) && body.version >= version && body.version < Number.MAX_SAFE_INTEGER) {
        await db.update(evoEngines).set({configVersion:sql`greatest(${evoEngines.configVersion},${body.version})+1`}).where(and(eq(evoEngines.id,id),isNull(evoEngines.removedAt)));
        invalidateEngineCache();
        continue;
      }
      if ([404,405].includes(response.status)) { await record(id,version,"too_old","This engine does not support configuration push"); return; }
      if (response.status === 422) {
        let message = typeof body.detail === "string" ? body.detail : Array.isArray(body.detail) ? body.detail.map(d=>typeof d?.msg === "string" ? d.msg : "Invalid setting").join("; ") : "Engine rejected configuration";
        // Engine errors are untrusted, including Pydantic inputs; never persist credentials or envelopes.
        for (const secret of [token,...Object.entries(config).filter(([k])=>ENGINE_CONFIG_BY_KEY.get(k)?.secret).map(([,v])=>String(v))].filter(Boolean)) message = message.split(secret).join("[redacted]");
        message = message.replace(/enc:v1:[\w:-]+/g,"[redacted]").replace(/[\x00-\x1f]/g," ").slice(0,300);
        await record(id,version,"rejected",message); return;
      }
      await record(id,version,"pending",`Configuration push returned ${response.status}`); return;
    } catch { await record(id,version,"pending","Engine unreachable; will retry when online"); return; }
  }
}
/** Health is reachable here; failures stay separate from scheduling health. */
export async function reconcileEngineConfig(id:string,reported:ReportedConfig) {
  const rows = await configRows(id);
  const [row] = await db.select().from(evoEngines).where(and(eq(evoEngines.id,id),isNull(evoEngines.removedAt)));
  if (!row || (!rows.length && row.configVersion === 0)) return;
  const [sync] = await db.select().from(engineConfigSync).where(eq(engineConfigSync.engineId,id));
  if (sync?.state === "too_old" || sync?.state === "rejected") return;
  if (reported.config_version === row.configVersion && reported.config_managed === true) { await record(id,row.configVersion,"in_sync",null,reported.restart_needed); return; }
  await pushEngineConfig(id);
}
/** Caller schedules this after the response; a failing engine cannot fail an accepted save. */
export async function pushAffectedEngines(ids:string[]) { await Promise.allSettled(ids.map(id=>pushEngineConfig(id))); }
