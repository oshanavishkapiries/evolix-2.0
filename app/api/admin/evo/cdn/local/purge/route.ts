import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

/** Purge unpinned local files on the selected engine; playing files are retained. */
export const POST = adminRoute(async (req) => engineProxyFor(req, "POST", "/cdn/local/purge"));
