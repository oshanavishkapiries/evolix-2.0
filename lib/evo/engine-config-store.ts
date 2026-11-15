import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { configAudit, engineConfig, engineConfigSync, evoEngines } from "@/db/schema";
import { decryptSecret, encryptForEngine, encryptSecret, maskSecret } from "@/lib/config/crypto";
import { registeredEngines, invalidateEngineCache } from "./registry";
import { ENGINE_CONFIG_BY_KEY, ENGINE_CONFIG_SPECS, mergeEngineConfig, splitEngineConfig, validateEngineValue, type ConfigSyncStatus, type EngineValues } from "./engine-config";

export class EngineConfigError extends Error { constructor(message:string, public status = 422, public errors?:Record<string,string>) { super(message); } }
export type EngineConfigRow = typeof engineConfig.$inferSelect;
export async function configScope(input: string | null) {
  if (!input || input === "global") return "global";
  if (!input.startsWith("engine:") || !(await registeredEngines()).some(e=>e.id === input.slice(7))) throw new EngineConfigError("Engine scope not found",404);
  return input.slice(7);
}
export const auditScope = (scope:string) => scope === "global" ? "engine-global" : `engine:${scope}`;
const unpack = (r:EngineConfigRow) => r.isSecret ? decryptSecret(r.value) : JSON.parse(r.value);
export function effectiveEngineConfig(rows:EngineConfigRow[], id:string): EngineValues {
  const values = (scope:string) => Object.fromEntries(rows.filter(r=>r.scope === scope).map(r=>[r.key,unpack(r)]));
  return mergeEngineConfig(values("global"),values(id));
}
export function buildPushPayload(version:number, config:EngineValues, token:string) {
  const {values,secrets} = splitEngineConfig(config);
  return {version,values,secrets:Object.fromEntries(Object.entries(secrets).map(([k,v])=>[k,encryptForEngine(v,token)]))};
}
export async function configRows(id?:string) { return db.select().from(engineConfig).where(id ? inArray(engineConfig.scope,["global",id]) : undefined); }
export async function syncStatus(id:string): Promise<ConfigSyncStatus> {
  const [row] = await db.select().from(evoEngines).where(and(eq(evoEngines.id,id),isNull(evoEngines.removedAt)));
  const [sync] = await db.select().from(engineConfigSync).where(eq(engineConfigSync.engineId,id));
  const rows = await configRows(id);
  return {state:sync?.state ?? "pending",lastError:sync?.lastError ?? null,lastAttemptAt:sync?.lastAttemptAt?.toISOString() ?? null,restartNeeded:sync?.restartNeeded ?? [],version:row?.configVersion ?? 0,pushedVersion:row?.configPushedVersion ?? 0,managed:rows.length > 0 || (row?.configVersion ?? 0) > 0};
}
export async function configSnapshot(scope:string) {
  const rows = await configRows(scope), effective = effectiveEngineConfig(rows,scope);
  return {data: ENGINE_CONFIG_SPECS.map(s=>{
    const own = rows.some(r=>r.scope === scope && r.key === s.key), global = rows.some(r=>r.scope === "global" && r.key === s.key);
    const value = effective[s.key];
    return {key:s.key,value:value === undefined ? null : s.secret ? maskSecret(String(value)) : value,source:own && scope !== "global" ? "engine override" : global ? "global" : "engine default",overridden:own};
  }), sync:scope === "global" ? null : await syncStatus(scope)};
}
async function ensureConfigEngines() {
  const refs = await registeredEngines();
  if (refs.length) {
    await db.insert(evoEngines).values(refs.map(e=>({id:e.id,url:e.url}))).onConflictDoNothing();
    invalidateEngineCache();
  }
}
/** All validation precedes writes; one CTE commits rows, masked audit and versions together. */
export async function saveEngineConfig(scope:string, input:unknown, actor:string, resetKeys:string[] = [], action:"set"|"reset"|"rollback" = "set") {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new EngineConfigError("Expected a setting object");
  const parsed:EngineValues = {}, errors:Record<string,string> = {};
  for (const [key,value] of Object.entries(input)) {
    try { const v = validateEngineValue(key,value); if (!(ENGINE_CONFIG_BY_KEY.get(key)!.secret && v === "")) parsed[key] = v; }
    catch(e) { errors[key] = e instanceof Error ? e.message : "Invalid setting"; }
  }
  for (const key of resetKeys) if (!ENGINE_CONFIG_BY_KEY.has(key)) errors[key] = "Unknown engine setting";
  if (Object.keys(errors).length) throw new EngineConfigError("Check the engine settings",422,errors);
  const existing = await db.select().from(engineConfig).where(eq(engineConfig.scope,scope));
  const changes = [...Object.keys(parsed),...resetKeys].flatMap(key=>{
    const old = existing.find(r=>r.key === key), reset = resetKeys.includes(key), secret = ENGINE_CONFIG_BY_KEY.get(key)!.secret;
    if (reset ? !old : old && unpack(old) === parsed[key]) return [];
    const show = (value:unknown) => value === undefined ? null : secret ? maskSecret(String(value)) : JSON.stringify(value);
    return [{key,value:reset ? null : secret ? encryptSecret(String(parsed[key])) : JSON.stringify(parsed[key]),secret,expected:old?.value ?? null,old_value:show(old ? unpack(old) : undefined),new_value:show(reset ? undefined : parsed[key])}];
  });
  if (!changes.length) return [];
  await ensureConfigEngines();
  try {
    const result = await db.execute(sql`with input as (
      select * from jsonb_to_recordset(${JSON.stringify(changes)}::jsonb) as x(key text,value text,secret boolean,expected text,old_value text,new_value text)
    ), saved as (
      insert into engine_config (scope,key,value,is_secret,updated_by)
      select ${scope},key,value,secret,${actor} from input where value is not null and (expected is null or exists (select 1 from engine_config c where c.scope=${scope} and c.key=input.key and c.value=input.expected))
      on conflict (scope,key) do update set value=excluded.value,is_secret=excluded.is_secret,updated_by=excluded.updated_by,updated_at=now()
      where exists (select 1 from input i where i.key=engine_config.key and i.expected=engine_config.value) returning key
    ), deleted as (
      delete from engine_config c using input i where c.scope=${scope} and c.key=i.key and i.value is null and c.value=i.expected returning c.key
    ), assertion as (
      select 1 / (case when (select count(*) from saved)+(select count(*) from deleted)=${changes.length} then 1 else 0 end) as valid
    ), audited as (
      insert into config_audit (key,scope,old_value,new_value,actor,action)
      select i.key,${auditScope(scope)},i.old_value,i.new_value,${actor},${action} from input i cross join assertion a where a.valid=1 returning id
    ), bumped as (
      update evo_engines set config_version=config_version+1 where removed_at is null and (${scope}='global' or id=${scope}) and (select count(*) from audited)>0 returning id
    )
    insert into engine_config_sync (engine_id,state) select id,'pending' from bumped
    on conflict (engine_id) do update set state='pending',last_error=null returning engine_id`);
    invalidateEngineCache();
    return result.rows.map(r=>String(r.engine_id));
  } catch { throw new EngineConfigError("Configuration changed concurrently; reload and retry",409); }
}
export async function engineConfigAudit(scope:string, key?:string, limit=25, before?:{at:Date;id:string}) {
  if (key && !ENGINE_CONFIG_BY_KEY.has(key)) throw new EngineConfigError("Unknown engine setting",400);
  if (!Number.isInteger(limit) || limit < 1 || limit > 101 || (before && !Number.isFinite(before.at.getTime()))) throw new EngineConfigError("Invalid audit filter",400);
  const rows = await db.select().from(configAudit).where(and(eq(configAudit.scope,auditScope(scope)),inArray(configAudit.key,[...ENGINE_CONFIG_BY_KEY.keys()]),key ? eq(configAudit.key,key) : undefined,before ? sql`(${configAudit.at},${configAudit.id}) < (${before.at},${before.id}::uuid)` : undefined)).orderBy(desc(configAudit.at),desc(configAudit.id)).limit(limit);
  return rows.map(r=>({...r,oldValue:ENGINE_CONFIG_BY_KEY.get(r.key)?.secret && r.oldValue !== null ? "••••" : r.oldValue,newValue:ENGINE_CONFIG_BY_KEY.get(r.key)?.secret && r.newValue !== null ? "••••" : r.newValue,canRollback:!ENGINE_CONFIG_BY_KEY.get(r.key)?.secret}));
}
export async function rollbackEngineConfig(id:string,actor:string) {
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) throw new EngineConfigError("Invalid audit ID",400);
  const [entry] = await db.select().from(configAudit).where(eq(configAudit.id,id));
  if (!entry || !(entry.scope === "engine-global" || entry.scope.startsWith("engine:")) || !ENGINE_CONFIG_BY_KEY.has(entry.key)) throw new EngineConfigError("History entry not found",404);
  if (ENGINE_CONFIG_BY_KEY.get(entry.key)!.secret) throw new EngineConfigError("Secret history cannot be restored");
  const scope = await configScope(entry.scope === "engine-global" ? "global" : entry.scope);
  const affected = await saveEngineConfig(scope,entry.oldValue === null ? {} : {[entry.key]:JSON.parse(entry.oldValue)},actor,entry.oldValue === null ? [entry.key] : [],"rollback");
  return {scope,affected};
}
