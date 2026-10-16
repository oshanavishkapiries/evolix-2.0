import { adminRoute } from "@/lib/cms/api";
import { engineProxy } from "@/lib/cms/evo-admin";

export const GET = adminRoute(async () => engineProxy("GET", "/queue"));
