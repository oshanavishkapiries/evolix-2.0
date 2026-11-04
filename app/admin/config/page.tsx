import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { listEngines } from "@/lib/evo/registry";
import { PageHeader } from "../_components/page-header";
import { SettingsShell } from "../_components/settings-tabs";
import { EngineConfigSyncChip } from "../_components/engine-config-panel";
import "../config.css";

export default function ConfigurationPage() {
  return <SettingsShell><PageHeader title="Configuration" /><p className="cfg-lead">Pick an application to view and change its environment variables.</p>
    <Suspense fallback={<p aria-busy="true">Loading applications…</p>}><Applications /></Suspense></SettingsShell>;
}
async function Applications() {
  await connection();
  const { engines } = await listEngines();
  return <ul className="cfg-grid">
    <li><Link className="cfg-card" href="/admin/config/app"><strong>Main application</strong><span>Mail, auth, integrations, Evo and error alerts for the Next.js app.</span></Link></li>
    <li><Link className="cfg-card" href="/admin/config/defaults"><strong>Engine defaults</strong><span>Global values applied to every Evo engine unless overridden.</span></Link></li>
    {engines.map((e) => <li key={e.id}><Link className="cfg-card" href={`/admin/config/engines/${encodeURIComponent(e.id)}`}><strong>{e.name}</strong><span>{e.url}</span><EngineConfigSyncChip engine={e.id} /></Link></li>)}
  </ul>;
}
