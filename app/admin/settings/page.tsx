import { PageHeader } from "../_components/page-header";
import { SettingsShell } from "../_components/settings-tabs";
import { PlatformSettings } from "../_components/platform-settings";
import { getSetting } from "@/lib/settings";

export default async function AdminSettingsPage() {
  return (
    <SettingsShell>
      <PageHeader title="Settings" />
      <PlatformSettings requireApproval={await getSetting("requireApproval")} playerFeedback={await getSetting("playerFeedback")} />
    </SettingsShell>
  );
}
