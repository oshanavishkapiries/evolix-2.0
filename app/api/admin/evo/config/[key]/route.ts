import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

/** Restores one setting of an engine to its .env value. */
export const DELETE = adminRoute<{ key: string }>(async (req, { key }) => engineProxyFor(req, "DELETE", `/config/${encodeURIComponent(key)}`));
