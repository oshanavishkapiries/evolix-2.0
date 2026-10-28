import { adminAnalytics, adminOverview, COST_PER_GB, GB_PER_HOUR } from "@/lib/cms/stats";
import { errorSummary } from "@/lib/errors/queries";
import { engineRows } from "@/lib/evo/scheduler";
import { OverviewView } from "./overview-view";

/** Dashboard: what needs someone, how the last week went, and the newest titles. Server-rendered. */
export async function AdminOverview() {
  const [o, days, errs, engines] = await Promise.all([adminOverview(), adminAnalytics(), errorSummary().catch(() => null), engineRows().catch(() => [])]);
  return <OverviewView o={o} days={days} errs={errs} engines={engines} rates={{ gbPerHour: GB_PER_HOUR, costPerGb: COST_PER_GB }} />;
}

