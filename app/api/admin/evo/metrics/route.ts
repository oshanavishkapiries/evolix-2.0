import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

/** Median / p95 extraction time, peak RAM and CPU per provider for the last 24 hours on one engine (`?engine=`). */
export const GET = adminRoute(async (req) => engineProxyFor(req, "GET", "/metrics?hours=24"));
