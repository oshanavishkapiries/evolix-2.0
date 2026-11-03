import { after, NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { fail, json } from "@/lib/auth/http";
import { configScope, configSnapshot, engineConfigAudit, EngineConfigError, rollbackEngineConfig, saveEngineConfig, syncStatus } from "./engine-config-store";
import { pushAffectedEngines, pushEngineConfig } from "./engine-config-sync";
export function engineConfigRoute(handler:(req:NextRequest,params:Record<string,string>,actor:string)=>Promise<NextResponse>) {
  return async (req:NextRequest,ctx:{params:Promise<Record<string,string>>}) => {
    const admin = await requireAdmin(req);
    if (admin instanceof NextResponse) { admin.headers.set("Cache-Control","no-store"); return admin; }
    let response:NextResponse;
    try { response = await handler(req,await ctx.params,admin.email); }
    catch(e) { response = e instanceof EngineConfigError ? fail(e.status,"ENGINE_CONFIG_ERROR",e.message,e.errors ? {errors:e.errors} : undefined) : fail(500,"ENGINE_CONFIG_ERROR","Engine configuration unavailable"); }
    response.headers.set("Cache-Control","no-store"); return response;
  };
}
const scopeFor = (req:NextRequest) => configScope(req.nextUrl.searchParams.get("scope"));
const schedule = (ids:string[]) => { if(ids.length) after(()=>pushAffectedEngines(ids)); };
export const engineConfigGet = engineConfigRoute(async req=>json(200,await configSnapshot(await scopeFor(req))));
export const engineConfigPut = engineConfigRoute(async (req,_p,actor)=>{
  const scope = await scopeFor(req);
  let body:unknown; try { body = await req.json(); } catch { throw new EngineConfigError("Invalid JSON body",400); }
  const ids = await saveEngineConfig(scope,body,actor); schedule(ids);
  return json(200,await configSnapshot(scope));
});
export const engineConfigDelete = engineConfigRoute(async (req,{key},actor)=>{
  const scope = await scopeFor(req), ids = await saveEngineConfig(scope,{},actor,[key],"reset"); schedule(ids);
  return json(200,await configSnapshot(scope));
});
export const engineConfigAuditGet = engineConfigRoute(async req=>{
  const q=req.nextUrl.searchParams, scope=await scopeFor(req), limit=Number(q.get("limit") ?? 25);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new EngineConfigError("Limit must be 1–100",400);
  let before:{at:Date;id:string}|undefined;
  if (q.has("before")) {
    try {
      const cursor=JSON.parse(Buffer.from(q.get("before")!,"base64url").toString());
      if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(cursor.id) || !Number.isFinite(Date.parse(cursor.at))) throw new Error();
      before={at:new Date(cursor.at),id:cursor.id};
    } catch { throw new EngineConfigError("Invalid history cursor",400); }
  }
  const rows=await engineConfigAudit(scope,q.get("key") || undefined,limit+1,before), page=rows.slice(0,limit), last=page.at(-1);
  return json(200,{data:page,next:rows.length > limit && last ? Buffer.from(JSON.stringify({at:last.at.toISOString(),id:last.id})).toString("base64url") : null});
});
export const engineConfigRollback = engineConfigRoute(async (_req,{id},actor)=>{
  const {scope,affected} = await rollbackEngineConfig(id,actor); schedule(affected); return json(200,await configSnapshot(scope));
});
export const engineConfigPush = engineConfigRoute(async (_req,{id})=>{
  await configScope(`engine:${id}`); await pushEngineConfig(id,true); return json(200,{sync:await syncStatus(id)});
});
