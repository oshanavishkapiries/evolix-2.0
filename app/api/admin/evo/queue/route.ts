import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

export const GET = adminRoute(async (req) => engineProxyFor(req, "GET", "/queue"));
