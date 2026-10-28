import { redirect } from "next/navigation";
import { defaultEngine } from "@/lib/evo/client";

/** Settings live on each engine's page now; the old "Pipeline control" link opens the primary engine's settings. */
export default function EvoSettingsPage() {
  redirect(`/admin/evo/engines/${encodeURIComponent(defaultEngine().id)}?tab=settings`);
}
