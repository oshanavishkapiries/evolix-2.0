import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

/** Health of each stream provider on one engine (`?engine=`): healthy, cooling down until a time, or waiting for a trial. */
export const GET = adminRoute(async (req) => engineProxyFor(req, "GET", "/providers"));
