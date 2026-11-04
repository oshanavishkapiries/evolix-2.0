import { TabNav } from "./tab-nav";

/** Variables / History tabs for one configuration target. */
export function ConfigTabs({ base }: { base: string }) {
  return <TabNav label="Configuration views" tabs={[{ href: base, label: "Variables", exact: true }, { href: `${base}/history`, label: "History" }]} />;
}
