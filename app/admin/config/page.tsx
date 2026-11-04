import { PageHeader } from "../_components/page-header";
import { ConfigPanel } from "../_components/config-panel";
import { SettingsShell } from "../_components/settings-tabs";
import "../config.css";
export default function ConfigurationPage() {
  return <SettingsShell><PageHeader title="Configuration" /><ConfigPanel /></SettingsShell>;
}
