import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
vi.mock("@/db",async()=>{
  const {PGlite}=await import("@electric-sql/pglite"), {drizzle}=await import("drizzle-orm/pglite");
  const client=new PGlite();return {db:drizzle(client),testClient:client};
});
vi.mock("@/lib/config",()=>({getConfig:vi.fn(async()=>({EVO_ENGINES:'["http://env.test:8000"]',EVO_SECRET_TOKEN:"fixture-fallback-token"}))}));
vi.mock("@/lib/openrouter",()=>({openRouterModels:vi.fn(async()=>[])}));
vi.mock("@/lib/auth/admin",()=>({requireAdmin:vi.fn(async()=>({id:"fixture-admin",email:"admin@example.test"}))}));
const scheduled=vi.hoisted(()=>[] as (()=>Promise<unknown>)[]);
vi.mock("next/server",async importOriginal=>({...await importOriginal<typeof import("next/server")>(),after:vi.fn((fn:()=>Promise<unknown>)=>scheduled.push(fn))}));
import * as database from "@/db";
import type {PGlite} from "@electric-sql/pglite";
import {NextRequest,NextResponse} from "next/server";
import {requireAdmin} from "@/lib/auth/admin";
import {ENGINE_CONFIG_SPECS,validateEngineValue,mergeEngineConfig,diffEngineConfig,splitEngineConfig,syncLabel} from "@/lib/evo/engine-config";
import {buildPushPayload,configRows,configSnapshot,effectiveEngineConfig,engineConfigAudit,rollbackEngineConfig,saveEngineConfig,syncStatus} from "@/lib/evo/engine-config-store";
import {pushEngineConfig,reconcileEngineConfig} from "@/lib/evo/engine-config-sync";
import {addEngine,registeredEngines} from "@/lib/evo/registry";
import {refreshHealth} from "@/lib/evo/scheduler";
import {decryptFromEngine,deriveEngineKey} from "@/lib/config/crypto";
import {GET,PUT} from "@/app/api/admin/evo/config/route";
import {DELETE} from "@/app/api/admin/evo/config/[key]/route";
import {GET as AUDIT} from "@/app/api/admin/evo/config/audit/route";
import {POST as ROLLBACK} from "@/app/api/admin/evo/config/audit/[id]/rollback/route";
import {GET as MODEL_GET, PUT as MODEL_PUT} from "@/app/api/admin/openrouter/model/route";
import {openRouterModels} from "@/lib/openrouter";
import {POST as PUSH} from "@/app/api/admin/evo/engines/[id]/push/route";
const client=(database as unknown as {testClient:PGlite}).testClient;
const actor="admin@example.test", token="fixture-specific-engine-token", secret="fixture-secret-only-1234";
const fetchMock=vi.fn();
let id:string,other:string;
const request=(method="GET",body?:unknown,scope="global",path="")=>new NextRequest(`http://app.test/api/admin/evo/config${path}?scope=${encodeURIComponent(scope)}`,{method,...(body === undefined ? {} : {body:JSON.stringify(body),headers:{"Content-Type":"application/json"}})});
const ctx=(params:Record<string,string>={})=>({params:Promise.resolve(params)});
const versions=async()=> (await client.query<{id:string;config_version:number;config_pushed_version:number}>("select id,config_version,config_pushed_version from evo_engines order by id")).rows;
const success=async(_url:string,init:RequestInit)=>{const p=JSON.parse(String(init.body));return Response.json({version:p.version,managed:true,applied:Object.keys(p.values),restart_needed:["CLEAN_ORPHANS_ON_START"]});};
beforeAll(async()=>{
  await client.exec(`create table evo_engines (id text primary key,url text not null,draining boolean not null default false,healthy boolean not null default true,last_checked_at timestamptz,last_ok_at timestamptz,last_error text,active_jobs integer not null default 0,queue_depth integer not null default 0,max_extractions integer not null default 1,free_disk_gb real,updated_at timestamptz not null default now());`);
  for(const file of ["0021_silky_victor_mancha.sql","0022_orange_the_liberteens.sql","0023_slim_gauntlet.sql","0024_fantastic_gargoyle.sql","0025_cool_punisher.sql"]) await client.exec(readFileSync(`drizzle/${file}`,"utf8"));
});
beforeEach(async()=>{
  await client.exec("truncate evo_engines,engine_config,engine_config_sync,config_audit");
  vi.stubEnv("CONFIG_ENCRYPTION_KEY","ab".repeat(32));vi.stubGlobal("fetch",fetchMock);scheduled.length=0;
  fetchMock.mockReset().mockImplementation(success);
  vi.mocked(openRouterModels).mockResolvedValue([]);
  vi.mocked(requireAdmin).mockResolvedValue({id:"fixture-admin",email:actor});
  id=(await addEngine({name:"First",url:"http://first.test:8000",token},actor)).engine.id;
  other=(await addEngine({name:"Second",url:"http://second.test:8000",token:"fixture-second-engine-token"},actor)).engine.id;
  await client.exec("truncate config_audit");
});
afterAll(async()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();await client.close();});
describe("registry, validation and payload",()=>{
  it("matches every engine SPECS key, kind, bounds, choices, live/restart and secret flags",()=>{
    const fixture=JSON.parse(readFileSync("evo-engine/tests/vectors/engine_config_keys.json","utf8"));
    const simplify=(s:typeof ENGINE_CONFIG_SPECS[number])=>({key:s.key,kind:s.kind,min:s.min,max:s.max,choices:s.choices,live:s.live,restartNeeded:s.restartNeeded,secret:s.secret});
    expect(ENGINE_CONFIG_SPECS.map(simplify).sort((a,b)=>a.key.localeCompare(b.key))).toEqual(fixture.map((s:Omit<typeof ENGINE_CONFIG_SPECS[number],"choices"> & {choices:[string,string][]})=>simplify({...s,choices:s.choices.map(([value,label])=>({value,label}))})).sort((a:{key:string},b:{key:string})=>a.key.localeCompare(b.key)));
    expect(ENGINE_CONFIG_SPECS.every(s=>s.group && s.label && s.description)).toBe(true);
  });
  it.each([
    ["MAX_CONCURRENT_EXTRACTIONS",3,3],["CLEAN_ORPHANS_ON_START","true",true],["CLEAN_ORPHANS_ON_START",0,false],
    ["EVO_WEBHOOK_URL"," https://app.test/hook ","https://app.test/hook"],["ERROR_REPORT_URL","",""],["TRANSLATE_MODEL"," vendor/model:free ","vendor/model:free"],
    ["EXTRACTOR_ORDER","ythd,cinesrc","ythd,cinesrc"],["MIN_FREE_DISK_GB",1.5,1.5],["PIXELDRAIN_API_KEY","",""]
  ])("coerces %s with engine rules",(key,value,expected)=>expect(validateEngineValue(key as string,value)).toEqual(expected));
  it.each([
    ["EVO_PORT",8000],["EVO_SECRET_TOKEN","ignored"],["MAX_CONCURRENT_EXTRACTIONS","3"],["MAX_CONCURRENT_EXTRACTIONS",true],
    ["MAX_CONCURRENT_EXTRACTIONS",1.5],["MAX_CONCURRENT_EXTRACTIONS",9],["MIN_FREE_DISK_GB",Infinity],["CLEAN_ORPHANS_ON_START","True"],
    ["TRANSLATE_MODEL","not-a-model"],["EVO_WEBHOOK_URL","http://user:pass@app.test/hook"],["ERROR_REPORT_URL","ftp://app.test"],["ERROR_REPORT_URL","https:/app.test"],
    ["ERROR_REPORT_URL","https://app.test/white space"],["OPENROUTER_API_KEY",9],["EXTRACTOR_ORDER","unknown"]
  ])("rejects invalid %s",(key,value)=>expect(()=>validateEngineValue(key as string,value)).toThrow());
  it("merges overrides, diffs removals and splits secrets",()=>{
    const a={MAX_QUEUED_TASKS:20,OPENROUTER_API_KEY:secret}, b=mergeEngineConfig(a,{MAX_QUEUED_TASKS:30});
    expect(b).toEqual({...a,MAX_QUEUED_TASKS:30});expect(diffEngineConfig(a,{MAX_QUEUED_TASKS:30})).toEqual(["MAX_QUEUED_TASKS","OPENROUTER_API_KEY"]);
    expect(splitEngineConfig(b)).toEqual({values:{MAX_QUEUED_TASKS:30},secrets:{OPENROUTER_API_KEY:secret}});
  });
  it("matches the shared crypto vector and encrypts push secrets for the selected token",()=>{
    const v=JSON.parse(readFileSync("evo-engine/tests/vectors/engine_config_crypto.json","utf8"));
    expect(deriveEngineKey(v.token).toString("hex")).toBe(v.derived_key_hex);expect(decryptFromEngine(v.envelope,v.token)).toBe(v.plaintext);
    const p=buildPushPayload(12,{OPENROUTER_API_KEY:secret,MAX_QUEUED_TASKS:12},token);
    expect(p.version).toBe(12);expect(p.values).toEqual({MAX_QUEUED_TASKS:12});expect(JSON.stringify(p)).not.toContain(secret);
    expect(decryptFromEngine(p.secrets.OPENROUTER_API_KEY,token)).toBe(secret);expect(()=>decryptFromEngine(p.secrets.OPENROUTER_API_KEY,"wrong-token")).toThrow();
  });
});
describe("atomic store and masked API",()=>{
  it("increments every nonremoved engine on global changes, only the target on overrides, and neither for no-ops",async()=>{
    const removed=(await addEngine({name:"Removed",url:"http://removed.test:8000"},actor)).engine.id;
    await client.query("update evo_engines set removed_at=now() where id=$1",[removed]);
    expect((await saveEngineConfig("global",{MAX_QUEUED_TASKS:20,MIN_FREE_DISK_GB:3},actor)).sort()).toEqual([id,other].sort());
    await saveEngineConfig(id,{MAX_QUEUED_TASKS:30},actor);await saveEngineConfig(id,{MAX_QUEUED_TASKS:30},actor);
    const rows=await versions();expect(rows.find(r=>r.id===id)?.config_version).toBe(2);expect(rows.find(r=>r.id===other)?.config_version).toBe(1);expect(rows.find(r=>r.id===removed)?.config_version).toBe(0);
    expect(effectiveEngineConfig(await configRows(id),id)).toEqual({MAX_QUEUED_TASKS:30,MIN_FREE_DISK_GB:3});
    expect((await configSnapshot(id)).data.find(r=>r.key === "MAX_QUEUED_TASKS")).toMatchObject({source:"engine override",value:30});
    await saveEngineConfig(id,{},actor,["MAX_QUEUED_TASKS"],"reset");expect((await configSnapshot(id)).data.find(r=>r.key === "MAX_QUEUED_TASKS")).toMatchObject({source:"global",value:20});
  });
  it("validates every key before any write and rolls rows/audit/versions back on a DB failure",async()=>{
    await expect(saveEngineConfig("global",{MAX_QUEUED_TASKS:20,MIN_FREE_DISK_GB:-1},actor)).rejects.toThrow();
    expect(await configRows()).toHaveLength(0);expect((await versions()).every(r=>r.config_version===0)).toBe(true);
    await client.exec("alter table config_audit add constraint deny_fixture_actor check (actor <> 'deny-fixture')");
    try {await expect(saveEngineConfig("global",{MAX_QUEUED_TASKS:20,MIN_FREE_DISK_GB:1},"deny-fixture")).rejects.toThrow(/reload/);}
    finally {await client.exec("alter table config_audit drop constraint deny_fixture_actor");}
    expect(await configRows()).toHaveLength(0);expect(await engineConfigAudit("global")).toHaveLength(0);expect((await versions()).every(r=>r.config_version===0)).toBe(true);
  });
  it("prevents partial batches during concurrent saves with conflicting expected values",async()=>{
    await saveEngineConfig("global",{MAX_QUEUED_TASKS:10,MIN_FREE_DISK_GB:1},actor);
    const results=await Promise.allSettled([saveEngineConfig("global",{MAX_QUEUED_TASKS:20,MIN_FREE_DISK_GB:2},actor),saveEngineConfig("global",{MAX_QUEUED_TASKS:30,MIN_FREE_DISK_GB:3},actor)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
    const cfg=effectiveEngineConfig(await configRows(),id);expect([[20,2],[30,3]]).toContainEqual([cfg.MAX_QUEUED_TASKS,cfg.MIN_FREE_DISK_GB]);
  });
  it("encrypts at rest, masks every response and audit, ignores blank replacements, refuses secret rollback",async()=>{
    await saveEngineConfig("global",{OPENROUTER_API_KEY:secret,PIXELDRAIN_API_KEY:"tiny"},actor);
    const rows=await configRows();expect(rows.every(r=>r.value.startsWith("enc:v1:"))).toBe(true);
    const snapshot=await configSnapshot(id);expect(JSON.stringify(snapshot)).not.toContain(secret);expect(JSON.stringify(snapshot)).not.toContain("enc:v1:");
    expect(snapshot.data.find(r=>r.key === "PIXELDRAIN_API_KEY")?.value).toBe("••••");
    await saveEngineConfig("global",{OPENROUTER_API_KEY:""},actor);expect((await versions())[0].config_version).toBe(1);
    const audit=await engineConfigAudit("global");expect(JSON.stringify(audit)).not.toContain(secret);expect(audit[0].newValue).toBe("••••");
    await expect(rollbackEngineConfig(audit[0].id,actor)).rejects.toThrow(/Secret/);
    expect(JSON.stringify((await client.query("select * from config_audit")).rows)).not.toContain(secret);
  });
  it("rolls back nonsecret entries including restoring the absence of an override",async()=>{
    await saveEngineConfig(id,{MAX_QUEUED_TASKS:20},actor);const [first]=await engineConfigAudit(id);
    await saveEngineConfig(id,{MAX_QUEUED_TASKS:30},actor);const [second]=await engineConfigAudit(id);
    await rollbackEngineConfig(second.id,actor);expect(effectiveEngineConfig(await configRows(id),id).MAX_QUEUED_TASKS).toBe(20);
    await rollbackEngineConfig(first.id,actor);expect(await configRows(id)).toHaveLength(0);
    expect((await engineConfigAudit(id)).some(a=>a.action === "rollback")).toBe(true);
  });
  it("guards all endpoints before accessing configuration",async()=>{
    for(const status of [401,403]) {
      vi.mocked(requireAdmin).mockResolvedValue(NextResponse.json({ok:false},{status}));
      for(const handler of [GET,PUT,DELETE,AUDIT,ROLLBACK,PUSH]) {const res=await handler(request(),ctx({id,key:"MAX_QUEUED_TASKS"}));expect(res.status).toBe(status);expect(res.headers.get("Cache-Control")).toBe("no-store");}
    }
    expect(await configRows()).toHaveLength(0);
  });
  it("returns no-store masked snapshots and schedules pushes after save without waiting for fetch",async()=>{
    const res=await PUT(request("PUT",{OPENROUTER_API_KEY:secret,MAX_QUEUED_TASKS:20}),ctx());
    expect(res.status).toBe(200);expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).not.toContain(secret);expect(fetchMock).not.toHaveBeenCalled();expect(scheduled).toHaveLength(1);
    fetchMock.mockRejectedValue(new Error(secret));await scheduled[0]();expect((await syncStatus(id)).state).toBe("pending");
    const history=await AUDIT(request(),ctx());expect(await history.text()).not.toContain(secret);
  });
  it("rejects invalid scope, malformed JSON and batches without reflecting secret input",async()=>{
    const bad=await PUT(request("PUT",{OPENROUTER_API_KEY:secret,MAX_QUEUED_TASKS:0}),ctx());expect(bad.status).toBe(422);expect(await bad.text()).not.toContain(secret);expect(await configRows()).toHaveLength(0);
    expect((await GET(request("GET",undefined,"engine:missing"),ctx())).status).toBe(404);
    expect((await PUT(new NextRequest("http://app.test/api/admin/evo/config",{method:"PUT",body:"{"}),ctx())).status).toBe(400);
    expect((await AUDIT(new NextRequest("http://app.test/api/admin/evo/config/audit?limit=101"),ctx())).status).toBe(400);
  });
  it("paginates equal-timestamp audit entries with a key filter and excludes other scopes",async()=>{
    for (const n of [10,20,30]) await saveEngineConfig(id,{MAX_QUEUED_TASKS:n},actor);
    await saveEngineConfig("global",{MAX_QUEUED_TASKS:40},actor);
    await client.exec("update config_audit set at='2026-01-01T00:00:00.000Z'");
    const url=`http://app.test/api/admin/evo/config/audit?scope=engine:${id}&key=MAX_QUEUED_TASKS&limit=2`;
    const first=await (await AUDIT(new NextRequest(url),ctx())).json();expect(first.data).toHaveLength(2);expect(first.next).toBeTruthy();
    const second=await (await AUDIT(new NextRequest(`${url}&before=${first.next}`),ctx())).json();expect(second.data).toHaveLength(1);expect(second.next).toBeNull();
    expect(new Set([...first.data,...second.data].map(r=>r.id)).size).toBe(3);
    expect((await AUDIT(new NextRequest(`${url}&before=invalid`),ctx())).status).toBe(400);
  });
  it("never logs secrets, envelopes or failing engine errors",async()=>{
    const log=vi.spyOn(console,"log"),warn=vi.spyOn(console,"warn"),error=vi.spyOn(console,"error");
    try {
      const response=await PUT(request("PUT",{OPENROUTER_API_KEY:secret}),ctx());expect(response.status).toBe(200);
      fetchMock.mockRejectedValue(new Error(secret));await scheduled[0]();
      expect(JSON.stringify([log.mock.calls,warn.mock.calls,error.mock.calls])).not.toContain(secret);
      expect(JSON.stringify([log.mock.calls,warn.mock.calls,error.mock.calls])).not.toContain("enc:v1:");
      expect(await (await GET(request("GET",undefined,`engine:${id}`),ctx())).text()).not.toContain(secret);
    } finally {log.mockRestore();warn.mockRestore();error.mockRestore();}
  });
  it("supports reset, rollback and manual push routes",async()=>{
    await PUT(request("PUT",{MAX_QUEUED_TASKS:20},`engine:${id}`),ctx());
    const entry=(await engineConfigAudit(id))[0];
    expect((await ROLLBACK(request("POST"),ctx({id:entry.id}))).status).toBe(200);
    await PUT(request("PUT",{MAX_QUEUED_TASKS:30},`engine:${id}`),ctx());
    expect((await DELETE(request("DELETE",undefined,`engine:${id}`),ctx({key:"MAX_QUEUED_TASKS"}))).status).toBe(200);
    const response=await PUSH(request("POST"),ctx({id}));expect(response.status).toBe(200);expect((await response.json()).sync.state).toBe("in_sync");
  });
});
describe("push and reconciliation",()=>{
  it("never pushes an engine with no DB configuration and no prior managed version",async()=>{
    await pushEngineConfig(id,true);await reconcileEngineConfig(id,{config_version:0,config_managed:false});expect(fetchMock).not.toHaveBeenCalled();expect((await syncStatus(id)).managed).toBe(false);
  });
  it("pushes complete effective state, uses per-engine credentials, and records restart keys",async()=>{
    await saveEngineConfig("global",{OPENROUTER_API_KEY:secret,MAX_QUEUED_TASKS:20},actor);await saveEngineConfig(id,{MAX_QUEUED_TASKS:30},actor);
    await pushEngineConfig(id);
    const [url,init]=fetchMock.mock.calls[0], payload=JSON.parse(init.body);
    expect(url).toBe("http://first.test:8000/api/v1/media/config/push");expect(init.method).toBe("PUT");expect(init.headers["X-Evo-Secret"]).toBe(token);
    expect(payload.values).toEqual({MAX_QUEUED_TASKS:30});expect(decryptFromEngine(payload.secrets.OPENROUTER_API_KEY,token)).toBe(secret);
    expect(await syncStatus(id)).toMatchObject({state:"in_sync",version:2,pushedVersion:2,restartNeeded:["CLEAN_ORPHANS_ON_START"]});
  });
  it("sends an empty desired state after resetting the last override",async()=>{
    await saveEngineConfig(id,{MAX_QUEUED_TASKS:20},actor);await pushEngineConfig(id);
    await saveEngineConfig(id,{},actor,["MAX_QUEUED_TASKS"],"reset");await pushEngineConfig(id);
    expect(JSON.parse(fetchMock.mock.lastCall?.[1].body)).toEqual({version:2,values:{},secrets:{}});
  });
  it("does not push when reported version and managed status match, and clears restarted keys",async()=>{
    await saveEngineConfig(id,{MAX_QUEUED_TASKS:20},actor);
    await reconcileEngineConfig(id,{config_version:1,config_managed:true,restart_needed:[]});expect(fetchMock).not.toHaveBeenCalled();expect(await syncStatus(id)).toMatchObject({state:"in_sync",pushedVersion:1,restartNeeded:[]});
  });
  it.each([{config_version:0,config_managed:true},{config_version:1,config_managed:false},{}])("resyncs a behind or unmanaged engine %j",async reported=>{
    await saveEngineConfig(id,{MAX_QUEUED_TASKS:20},actor);await reconcileEngineConfig(id,reported);expect(fetchMock).toHaveBeenCalledOnce();expect((await syncStatus(id)).state).toBe("in_sync");
  });
  it("keeps network failures pending and resyncs when an offline engine returns",async()=>{
    await saveEngineConfig(id,{MAX_QUEUED_TASKS:20},actor);fetchMock.mockRejectedValueOnce(new Error("offline"));await pushEngineConfig(id);expect((await syncStatus(id)).state).toBe("pending");
    await reconcileEngineConfig(id,{config_version:0,config_managed:false});expect(fetchMock).toHaveBeenCalledTimes(2);expect((await syncStatus(id)).state).toBe("in_sync");
  });
  it("adopts a newer engine version on 409, bumps above it and retries once",async()=>{
    await saveEngineConfig(id,{MAX_QUEUED_TASKS:20},actor);fetchMock.mockResolvedValueOnce(Response.json({detail:"stale",version:50},{status:409}));
    await reconcileEngineConfig(id,{config_version:50,config_managed:true});expect(fetchMock).toHaveBeenCalledTimes(2);expect(JSON.parse(fetchMock.mock.lastCall?.[1].body).version).toBe(51);expect(await syncStatus(id)).toMatchObject({version:51,pushedVersion:51,state:"in_sync"});
  });
  it("adopts stale versions above the old 32-bit DB bound",async()=>{
    await saveEngineConfig(id,{MAX_QUEUED_TASKS:20},actor);
    fetchMock.mockResolvedValueOnce(Response.json({detail:"stale",version:3000000000},{status:409}));
    await pushEngineConfig(id);expect(await syncStatus(id)).toMatchObject({version:3000000001,pushedVersion:3000000001,state:"in_sync"});
  });
  it("limits stale retries to one",async()=>{
    await saveEngineConfig(id,{MAX_QUEUED_TASKS:20},actor);fetchMock.mockImplementation(async()=>Response.json({version:99,detail:"stale"},{status:409}));await pushEngineConfig(id);expect(fetchMock).toHaveBeenCalledTimes(2);expect((await syncStatus(id)).state).toBe("pending");
  });
  it.each([404,405])("marks %s too old and stops health retries until edit or explicit push",async status=>{
    await saveEngineConfig(id,{MAX_QUEUED_TASKS:20},actor);fetchMock.mockResolvedValueOnce(Response.json({detail:"Not found"},{status}));await pushEngineConfig(id);expect(syncLabel(await syncStatus(id))).toBe("Engine needs update");
    await reconcileEngineConfig(id,{config_version:0,config_managed:false});expect(fetchMock).toHaveBeenCalledOnce();
    await pushEngineConfig(id,true);expect((await syncStatus(id)).state).toBe("in_sync");
  });
  it("stores a sanitized engine rejection and suppresses retries until configuration changes",async()=>{
    await saveEngineConfig(id,{OPENROUTER_API_KEY:secret},actor);
    fetchMock.mockResolvedValueOnce(Response.json({detail:`Bad configuration ${secret} ${token} enc:v1:abc:def:ghi`},{status:422}));await pushEngineConfig(id);
    expect(await syncStatus(id)).toMatchObject({state:"rejected",lastError:"Bad configuration [redacted] [redacted] [redacted]"});
    await reconcileEngineConfig(id,{config_version:0,config_managed:false});expect(fetchMock).toHaveBeenCalledOnce();
    await saveEngineConfig(id,{MAX_QUEUED_TASKS:20},actor);expect((await syncStatus(id)).state).toBe("pending");await reconcileEngineConfig(id,{config_version:0,config_managed:false});expect((await syncStatus(id)).state).toBe("in_sync");
    expect(JSON.stringify((await client.query("select * from engine_config_sync")).rows)).not.toContain(secret);
  });
  it("does not persist Pydantic input objects in rejected messages",async()=>{
    await saveEngineConfig(id,{OPENROUTER_API_KEY:secret},actor);fetchMock.mockResolvedValueOnce(Response.json({detail:[{msg:"Invalid secret envelope",input:secret}]},{status:422}));await pushEngineConfig(id);expect((await syncStatus(id)).lastError).toBe("Invalid secret envelope");
  });
  it("keeps a newer edit pending when an older push completes",async()=>{
    await saveEngineConfig(id,{MAX_QUEUED_TASKS:20},actor);
    fetchMock.mockImplementationOnce(async(url:string,init:RequestInit)=>{await saveEngineConfig(id,{MAX_QUEUED_TASKS:30},actor);return success(url,init);});
    await pushEngineConfig(id);expect(await syncStatus(id)).toMatchObject({state:"pending",version:2,pushedVersion:0});
    await reconcileEngineConfig(id,{config_version:1,config_managed:true});expect((await syncStatus(id)).state).toBe("in_sync");
  });
  it("starts new engines inheriting existing global defaults at a positive version",async()=>{
    await saveEngineConfig("global",{MAX_QUEUED_TASKS:20},actor);
    const added=(await addEngine({name:"Late",url:"http://late.test:8000",token},actor)).engine.id;
    await reconcileEngineConfig(added,{config_version:0,config_managed:false});expect(JSON.parse(fetchMock.mock.lastCall?.[1].body).version).toBe(1);expect((await syncStatus(added)).state).toBe("in_sync");
  });
  it("reconciles through the actual scheduler health cycle without changing health on push failure",async()=>{
    await saveEngineConfig("global",{MAX_QUEUED_TASKS:20},actor);
    fetchMock.mockImplementation(async(url:string)=>url.endsWith("/config/push") ? Response.json({detail:"Not found"},{status:404}) : Response.json(url.endsWith("/health") ? {status:"ok",config_version:0,config_managed:false} : {paused:false,extracting:0,caching:0,waiting_extraction:0,config_version:0,config_managed:false}));
    await refreshHealth(true);expect((await syncStatus(id)).state).toBe("too_old");expect((await client.query<{healthy:boolean}>("select healthy from evo_engines")).rows.every(r=>r.healthy)).toBe(true);
    expect(await registeredEngines()).toHaveLength(2);
  });
});

describe("OpenRouter model route integration",()=>{
  it("saves a global model with audit, version increments and deferred pushes, preserving the response shape",async()=>{
    const response=await MODEL_PUT(request("PUT",{model:"vendor/new-model"}),ctx());
    expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ok:true,data:{model:"vendor/new-model",engines:expect.arrayContaining([{id,name:"First",ok:true},{id:other,name:"Second",ok:true}])}});
    expect((await versions()).every(r=>r.config_version===1)).toBe(true);
    expect((await engineConfigAudit("global"))[0]).toMatchObject({key:"TRANSLATE_MODEL",actor,newValue:'"vendor/new-model"'});
    expect(fetchMock).not.toHaveBeenCalled();expect(scheduled).toHaveLength(1);await scheduled[0]();
    expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls.every(([url])=>url.endsWith("/config/push"))).toBe(true);
  });
  it("reads DB-effective models without engine access, including per-engine overrides",async()=>{
    await saveEngineConfig("global",{TRANSLATE_MODEL:"vendor/global"},actor);
    await saveEngineConfig(id,{TRANSLATE_MODEL:"vendor/override"},actor);
    const response=await MODEL_GET(request(),ctx());
    expect((await response.json()).data).toEqual(expect.arrayContaining([{id,name:"First",model:"vendor/override"},{id:other,name:"Second",model:"vendor/global"}]));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("falls back to read-only engine snapshots for legacy engines and unset model defaults",async()=>{
    fetchMock.mockImplementation(async()=>Response.json([{key:"TRANSLATE_MODEL",value:"vendor/legacy"}]));
    const legacy=await MODEL_GET(request(),ctx());expect((await legacy.json()).data.every((e:{model:string})=>e.model === "vendor/legacy")).toBe(true);
    expect(fetchMock.mock.calls.every(([url,init])=>url.endsWith("/config") && init.method === "GET")).toBe(true);
    fetchMock.mockReset().mockRejectedValue(new Error("offline"));
    const offline=await MODEL_GET(request(),ctx());expect((await offline.json()).data.every((e:{model:null;error:string})=>e.model === null && e.error === "The engine did not answer")).toBe(true);
  });
  it("retains catalogue and body validation, adds engine model-id validation, and enforces authentication",async()=>{
    expect((await MODEL_PUT(request("PUT",{model:"x"}),ctx())).status).toBe(400);
    expect((await MODEL_PUT(request("PUT",{model:"not-a-model"}),ctx())).status).toBe(422);
    vi.mocked(openRouterModels).mockResolvedValue([{id:"vendor/listed"}] as Awaited<ReturnType<typeof openRouterModels>>);
    expect((await MODEL_PUT(request("PUT",{model:"vendor/missing"}),ctx())).status).toBe(422);
    expect(await configRows()).toHaveLength(0);expect(fetchMock).not.toHaveBeenCalled();
    vi.mocked(requireAdmin).mockResolvedValue(NextResponse.json({ok:false},{status:403}));
    expect((await MODEL_GET(request(),ctx())).status).toBe(403);expect((await MODEL_PUT(request("PUT",{model:"vendor/listed"}),ctx())).status).toBe(403);
  });
});
