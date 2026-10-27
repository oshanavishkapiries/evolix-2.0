import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

/** CDN (Pixeldrain) account: plan, storage used, bandwidth. */
export const GET = adminRoute(async (req) => engineProxyFor(req, "GET", "/cdn/user"));
