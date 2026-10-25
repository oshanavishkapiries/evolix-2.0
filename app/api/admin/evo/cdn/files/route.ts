import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

/** Files in the CDN (Pixeldrain) account of an engine (`?engine=`, default: the primary). */
export const GET = adminRoute(async (req) => engineProxyFor(req, "GET", "/cdn/files"));
