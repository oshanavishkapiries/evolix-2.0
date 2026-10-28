import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

/** Drops the cached Sinhala translations of one engine (`?engine=`), so the next Sinhala request translates again. */
export const DELETE = adminRoute(async (req) => engineProxyFor(req, "DELETE", "/subtitles/si-cache"));
