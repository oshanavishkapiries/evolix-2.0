import { Breadcrumbs } from "../../_components/breadcrumbs";
import { ConfigPanel } from "../../_components/config-panel";
import { PageHeader } from "../../_components/page-header";
import { ConfigTabs } from "../../_components/config-tabs";
import { SettingsShell } from "../../_components/settings-tabs";
import "../../config.css";

export default function MainApplicationConfigPage() {
  return <SettingsShell><Breadcrumbs items={[{ label: "Configuration", href: "/admin/config" }, { label: "Main application" }]} /><PageHeader title="Main application" /><ConfigTabs base="/admin/config/app" /><ConfigPanel view="settings" /></SettingsShell>;
}
