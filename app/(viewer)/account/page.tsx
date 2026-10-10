import type { Metadata } from "next";
import { NavMarker } from "../_components/nav-marker";
import { PageHeader } from "../_components/page-header";
import { DashboardView } from "./dashboard-view";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <div className="v-page">
      <NavMarker active="account" />
      <PageHeader title="Account" />
      <DashboardView />
    </div>
  );
}
