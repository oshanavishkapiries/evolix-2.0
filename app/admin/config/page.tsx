import { PageHeader } from "../_components/page-header";
import { ConfigPanel } from "../_components/config-panel";
import { SettingsTabs } from "../_components/settings-tabs";
import "../config.css";
export default function ConfigurationPage() {
  return <><SettingsTabs /><PageHeader title="Configuration" /><ConfigPanel /></>;
}
