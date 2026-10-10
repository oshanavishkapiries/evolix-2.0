import type { Metadata } from "next";
import { PageHeader } from "../_components/page-header";
import { DashboardView } from "./dashboard-view";
import { PageMotion } from "../_components/motion";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <PageMotion>
    <div className="v-page">
      <PageHeader title="Account" />
      <DashboardView />
    </div>
    </PageMotion>
  );
}
