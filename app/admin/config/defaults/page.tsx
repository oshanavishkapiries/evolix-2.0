import { Breadcrumbs } from "../../_components/breadcrumbs";
import { EngineConfigPanel } from "../../_components/engine-config-panel";
import { PageHeader } from "../../_components/page-header";
import { ConfigTabs } from "../../_components/config-tabs";
import { SettingsShell } from "../../_components/settings-tabs";
import "../../config.css";

export default function EngineDefaultsConfigPage() {
  return <SettingsShell><Breadcrumbs items={[{ label: "Configuration", href: "/admin/config" }, { label: "Engine defaults" }]} /><PageHeader title="Engine defaults" /><ConfigTabs base="/admin/config/defaults" /><EngineConfigPanel locked view="settings" /></SettingsShell>;
}
