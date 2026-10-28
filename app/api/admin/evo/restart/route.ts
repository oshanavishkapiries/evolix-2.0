import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

/** Restarts one engine (`?engine=`). The engine refuses (409) while jobs run unless `force=1`; Docker starts it again. */
export const POST = adminRoute(async (req) => engineProxyFor(req, "POST", `/restart${req.nextUrl.searchParams.get("force") === "1" ? "?force=true" : ""}`));
