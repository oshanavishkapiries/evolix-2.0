import { adminRoute } from "@/lib/cms/api";
import { engineProxy } from "@/lib/cms/evo-admin";

/** Restores one setting to its .env value. */
export const DELETE = adminRoute<{ key: string }>(async (_req, { key }) => engineProxy("DELETE", `/config/${encodeURIComponent(key)}`));
