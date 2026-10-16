import { adminRoute } from "@/lib/cms/api";
import { engineProxy } from "@/lib/cms/evo-admin";

/** Files in the CDN (Pixeldrain) account. */
export const GET = adminRoute(async () => engineProxy("GET", "/cdn/files"));
