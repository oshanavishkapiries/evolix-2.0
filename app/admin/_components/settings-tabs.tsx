import { TabNav, type Tab } from "./tab-nav";

/** Sub-navigation shared by every page that lives under the Settings section. */
export const SETTINGS_TABS: Tab[] = [
  { href: "/admin/settings", label: "General", exact: true },
  { href: "/admin/config", label: "Configuration" },
  { href: "/admin/errors", label: "Errors" },
  { href: "/admin/reports", label: "Reports" },
];

export const isSettingsPath = (p: string) => SETTINGS_TABS.some((t) => p === t.href || p.startsWith(`${t.href}/`));

export function SettingsTabs() {
  return <TabNav label="Settings sections" tabs={SETTINGS_TABS} />;
}
