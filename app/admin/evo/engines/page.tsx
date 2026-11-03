import { EngineConfigSyncChip } from "../../_components/engine-config-panel";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { listEngines } from "@/lib/evo/registry";
import { AddEngineForm } from "./_components/registry-controls";

export default function EnginesPage() {
  return <Suspense fallback={<p>Loading engines…</p>}><Engines /></Suspense>;
}
async function Engines() {
  await connection();
  const { engines, managed } = await listEngines();
  return <div className="evo-stack">
    <div className="page-header"><div><h1>Engines</h1><p>Add engines and manage their individual credentials.</p></div><Link href="/admin/evo">Evo pipeline</Link></div>
    <p className="engine-registry-banner" role="status">{managed ? "Admin-managed engines are active. EVO_ENGINES is being ignored." : "No admin-managed engines exist. The EVO_ENGINES fallback list is active."}</p>
    <section className="evo-section"><h2>Registered engines</h2><div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>URL</th><th>Source</th><th>Token</th><th>State</th><th>Configuration</th></tr></thead><tbody>
      {engines.map((e) => <tr key={e.id}><td><Link href={`/admin/evo/engines/${encodeURIComponent(e.id)}`}>{e.name}</Link></td><td>{e.url}</td><td>{e.managed ? "Database" : "EVO_ENGINES"}</td><td>{e.tokenMask ?? "Global token fallback"}</td><td>{e.draining ? "Draining" : "Active"}</td><td><EngineConfigSyncChip engine={e.id}/></td></tr>)}
    </tbody></table></div>{!engines.length && <p>No active engines.</p>}</section>
    <Link href="/admin/evo/settings">Engine configuration</Link>
    <AddEngineForm />
  </div>;
}
