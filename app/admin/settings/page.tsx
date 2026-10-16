import { PageHeader } from "../_components/page-header";
import { PlatformSettings } from "../_components/platform-settings";
import { getSetting } from "@/lib/settings";

export default async function AdminSettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <PlatformSettings requireEmailVerification={await getSetting("requireEmailVerification")} />
    </>
  );
}
