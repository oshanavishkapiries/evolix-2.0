import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { listEngines } from "@/lib/evo/registry";
import { Breadcrumbs } from "../../../_components/breadcrumbs";
import { EngineConfigPanel } from "../../../_components/engine-config-panel";
import { PageHeader } from "../../../_components/page-header";
import { ConfigTabs } from "../../../_components/config-tabs";
import { SettingsShell } from "../../../_components/settings-tabs";
import "../../../config.css";

type Props = { params: Promise<{ id: string }> };

export default function EngineConfigPage({ params }: Props) {
  return <SettingsShell><Suspense fallback={<p aria-busy="true">Loading…</p>}><Engine params={params} /></Suspense></SettingsShell>;
}
async function Engine({ params }: Props) {
  await connection();
  const { id } = await params;
  const engine = (await listEngines()).engines.find((e) => e.id === id);
  if (!engine) notFound();
  return <><Breadcrumbs items={[{ label: "Configuration", href: "/admin/config" }, { label: engine.name }]} /><PageHeader title={engine.name} /><ConfigTabs base={`/admin/config/engines/${encodeURIComponent(engine.id)}`} /><EngineConfigPanel engine={engine.id} locked view="settings" /></>;
}
