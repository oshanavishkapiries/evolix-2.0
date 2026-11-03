"use client";
import {useCallback,useEffect,useState} from "react";
import {adminApi,errorText} from "@/lib/client/admin";
import {ENGINE_CONFIG_SPECS,ENGINE_CONFIG_BY_KEY,syncLabel,validateEngineValue,type ConfigSyncStatus,type EngineValues} from "@/lib/evo/engine-config";
import {SaveBar,useDirtyForm} from "./form-kit";
import {useConfirm} from "./confirm-dialog";
import {useToast} from "./toast";

type Row = {key:string;value:string|number|boolean|null;source:string;overridden:boolean};
type Snapshot = {data:Row[];sync:ConfigSyncStatus|null};
type Audit = {id:string;key:string;at:string;actor:string;action:string;oldValue:string|null;newValue:string|null;canRollback:boolean};
const callbackKey = (key:string) => ["EVO_WEBHOOK_URL","ERROR_REPORT_URL"].includes(key);
export function EngineConfigSyncChip({engine}:{engine:string}) {
  const [sync,setSync] = useState<ConfigSyncStatus|null>(null);
  useEffect(()=>{
    let alive=true;
    const load=()=>adminApi<Snapshot>("GET",`/api/admin/evo/config?scope=${encodeURIComponent(`engine:${engine}`)}`).then(r=>{if(alive && r.ok) setSync(r.sync);});
    const initial=setTimeout(load,0), poll=setInterval(load,10000);
    return ()=>{alive=false;clearTimeout(initial);clearInterval(poll);};
  },[engine]);
  return sync ? <span className="engine-config-sync" data-state={sync.state} role="status">{syncLabel(sync)}{sync.restartNeeded.length > 0 && <span> · Restart needed: {sync.restartNeeded.join(", ")}</span>}</span> : null;
}
export function EngineConfigPanel({engine}:{engine?:string}) {
  const [scope,setScope]=useState(engine ? `engine:${engine}` : "global");
  const [engines,setEngines]=useState<{id:string;name:string}[]>([]);
  const [snapshot,setSnapshot]=useState<Snapshot>();
  const [history,setHistory]=useState<Audit[]>([]);
  const [historyError,setHistoryError]=useState("");
  const [cursor,setCursor]=useState("");
  const [next,setNext]=useState<string|null>(null);
  const [filter,setFilter]=useState("");
  const [error,setError]=useState("");
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  const form=useDirtyForm({}), {markSaved}=form;
  const confirm=useConfirm(), toast=useToast();
  const query=`?scope=${encodeURIComponent(scope)}`, base="/api/admin/evo/config";
  const accept=useCallback((s:Snapshot)=>{
    setSnapshot({data:s.data,sync:s.sync});
    markSaved(Object.fromEntries(s.data.map(r=>[r.key,ENGINE_CONFIG_BY_KEY.get(r.key)!.secret ? "" : r.value === null ? "" : String(r.value)])));
    setErrors({});setError("");setCursor("");setRevision(v=>v+1);
  },[markSaved]);
  useEffect(()=>{
    let alive=true;
    adminApi<Snapshot>("GET",`${base}${query}`).then(r=>{if(alive) {if(r.ok) accept(r);else setError(errorText(r));}});
    return ()=>{alive=false;};
  },[query,accept]);
  useEffect(()=>{adminApi<{engines:{id:string;name:string}[]}>("GET","/api/admin/evo/engines").then(r=>{if(r.ok) setEngines(r.engines);});},[]);
  useEffect(()=>{
    let alive=true;
    adminApi<{data:Audit[];next:string|null}>("GET",`${base}/audit${query}&${new URLSearchParams({...filter ? {key:filter} : {},...cursor ? {before:cursor} : {}})}`).then(r=>{if(alive) {setHistoryError(r.ok ? "" : errorText(r));if(r.ok) {setHistory(r.data);setNext(r.next);}}});
    return ()=>{alive=false;};
  },[query,revision,filter,cursor]);
  useEffect(()=>{
    if(scope === "global") return;
    const poll=setInterval(()=>{adminApi<Snapshot>("GET",`${base}${query}`).then(r=>{if(r.ok) setSnapshot(old=>old ? {...old,sync:r.sync} : old);});},10000);
    return ()=>clearInterval(poll);
  },[scope,query]);
  const changes:EngineValues={}, invalid:Record<string,string>={};
  for(const s of ENGINE_CONFIG_SPECS) {
    const value=String(form.values[s.key] ?? ""), row=snapshot?.data.find(r=>r.key === s.key);
    const explicitEmpty=s.kind === "url" && row?.value === null && form.values[`__empty:${s.key}`] === true && value === "";
    if(!explicitEmpty && (s.secret ? !value : value === (row?.value === null || row?.value === undefined ? "" : String(row.value)))) continue;
    try { changes[s.key]=validateEngineValue(s.key,s.kind === "int" || s.kind === "float" ? value.trim() ? Number(value) : null : value); }
    catch(e) { invalid[s.key]=e instanceof Error ? e.message : "Invalid value"; }
  }
  const warnCallbacks=async (keys:string[])=>!keys.some(callbackKey) || await confirm({title:"Change reporting URLs?",body:"A wrong URL stops finished jobs reporting back to the app. Confirm these HTTP(S) callback addresses before continuing.",confirmLabel:"Confirm reporting URLs"});
  const save=async(event:React.FormEvent)=>{
    event.preventDefault();setErrors(invalid);if(Object.keys(invalid).length || !await warnCallbacks(Object.keys(changes))) return;
    setBusy(true);const r=await adminApi<Snapshot & {errors?:Record<string,string>}>("PUT",`${base}${query}`,changes);setBusy(false);
    if(!r.ok) {setErrors(r.errors ?? {});return toast.error(errorText(r));} accept(r);toast.success("Engine configuration saved; sync queued");
  };
  const mutate=async(path:string,method:"DELETE"|"POST",key:string)=>{
    if(!await confirm({title:"Restore configuration?",body:`This changes ${key}. ${form.dirty ? "Unsaved edits will be discarded." : ""}`,confirmLabel:"Restore"}) || !await warnCallbacks([key])) return;
    setBusy(true);const r=await adminApi<Snapshot>(method,path);setBusy(false);
    if(!r.ok) return toast.error(errorText(r));accept(r);toast.success("Configuration updated; sync queued");
  };
  const push=async()=>{
    setBusy(true);const r=await adminApi<{sync:ConfigSyncStatus}>("POST",`/api/admin/evo/engines/${encodeURIComponent(scope.slice(7))}/push`);setBusy(false);
    if(!r.ok) return toast.error(errorText(r));setSnapshot(old=>old ? {...old,sync:r.sync} : old);
  };
  return <div className="engine-config-panel evo-stack">
    <div className="toolbar"><label htmlFor="engine-config-scope">Configuration for</label><select id="engine-config-scope" value={scope} disabled={busy} onChange={async e=>{
      const next=e.target.value;
      if(form.dirty && !await confirm({title:"Discard unsaved changes?",body:"Switching scope discards your unsaved edits.",confirmLabel:"Discard and switch"})) return;
      markSaved({});setSnapshot(undefined);setHistory([]);setCursor("");setNext(null);setScope(next);
    }}><option value="global">Global defaults</option>{engines.map(e=><option key={e.id} value={`engine:${e.id}`}>{e.name}</option>)}</select></div>
    <p>Global defaults apply to every engine. Engine overrides take precedence. Unset keys use each engine’s .env default; that value is only known to the engine.</p>
    {snapshot?.sync && <div className="toolbar"><span className="engine-config-sync" data-state={snapshot.sync.state} role="status">{syncLabel(snapshot.sync)}</span><button type="button" disabled={busy || !snapshot.sync.managed} onClick={push}>Push now</button>{snapshot.sync.restartNeeded.length > 0 && <span className="warn-text">Restart needed: {snapshot.sync.restartNeeded.join(", ")}</span>}</div>}
    {error && <p role="alert">{error}</p>}
    {!snapshot ? <p aria-busy="true">Loading configuration…</p> : <form onSubmit={save}><fieldset disabled={busy}>
      {[...new Set(ENGINE_CONFIG_SPECS.map(s=>s.group))].map(group=><section className="evo-section" key={group}><h2>{group}</h2><ul className="set-list">
        {ENGINE_CONFIG_SPECS.filter(s=>s.group === group).map(s=>{
          const row=snapshot.data.find(r=>r.key === s.key)!, value=String(form.values[s.key] ?? "");
          const props={id:`engine-config-${s.key}`,value,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>form.setValues(old=>({...old,[s.key]:e.target.value})),"aria-invalid":Boolean(errors[s.key] || invalid[s.key]),"aria-describedby":`${s.key}-help`};
          return <li key={s.key}><div className="set-text"><label htmlFor={props.id}>{s.label}{s.secret ? " · Replace" : ""}</label><p id={`${s.key}-help`}>{s.description}</p><code>{s.key}</code>{s.restartNeeded && <p>Requires restart</p>}</div><div className="set-control">
            <span>Effective: {row.value === null ? "Engine .env default" : row.value === "" ? "(empty)" : String(row.value)} <span className="tag">{row.source}</span></span>
            {s.kind === "choice" || s.kind === "bool" ? <select {...props}><option value="" disabled>Engine default</option>{(s.kind === "bool" ? [{value:"true",label:"Enabled"},{value:"false",label:"Disabled"}] : s.choices).map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select> : <input {...props} type={s.secret ? "password" : s.kind === "int" || s.kind === "float" ? "number" : "text"} min={s.min} max={s.max} step={s.kind === "int" ? 1 : "any"} autoComplete={s.secret ? "new-password" : "off"} placeholder={s.secret ? "Blank keeps current secret" : "Engine default"} />}
            {s.secret && <small>Blank keeps the existing secret.</small>}
            {s.kind === "url" && row.value === null && <button type="button" className="btn-secondary" onClick={()=>form.setValues(old=>({...old,[s.key]:"",[`__empty:${s.key}`]:true}))}>Use empty value ({s.key === "EVO_WEBHOOK_URL" ? "disable callbacks" : "derive from completion webhook"})</button>}
            {(errors[s.key] || invalid[s.key]) && <span role="alert">{errors[s.key] || invalid[s.key]}</span>}
            {row.overridden && <button type="button" className="btn-secondary" onClick={()=>mutate(`${base}/${s.key}${query}`,"DELETE",s.key)}>Reset override</button>}
          </div></li>;
        })}
      </ul></section>)}
    </fieldset><SaveBar dirty={form.dirty} saving={busy} onDiscard={form.discard}/></form>}
    <section className="evo-section"><h2>Configuration history</h2><p>Only engine configuration history is shown. Secrets cannot be restored from masked history.</p><label htmlFor="engine-config-history-filter">Filter key</label><select id="engine-config-history-filter" value={filter} onChange={e=>{setFilter(e.target.value);setCursor("");}}><option value="">All keys</option>{ENGINE_CONFIG_SPECS.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select>{historyError && <p role="alert">{historyError}</p>}<div className="table-wrap"><table className="data-table"><thead><tr><th>Time / actor</th><th>Key</th><th>Before → after</th><th>Action</th></tr></thead><tbody>{history.map(h=><tr key={h.id}><td>{new Date(h.at).toLocaleString()}<br/>{h.actor}</td><td>{h.key}</td><td>{h.oldValue ?? "Engine default"} → {h.newValue ?? "Engine default"}</td><td><button type="button" disabled={busy || !h.canRollback} title={h.canRollback ? "Restore previous override" : "Secrets cannot be rolled back"} onClick={()=>mutate(`${base}/audit/${h.id}/rollback`,"POST",h.key)}>Rollback</button></td></tr>)}</tbody></table></div>{!history.length && <p>No changes yet.</p>}<div className="toolbar">{cursor && <button type="button" onClick={()=>setCursor("")}>Newest</button>}{next && <button type="button" onClick={()=>setCursor(next)}>Older</button>}</div></section>
  </div>;
}
