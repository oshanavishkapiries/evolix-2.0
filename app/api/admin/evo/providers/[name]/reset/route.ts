import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

/** Ends a provider's cool-down on one engine (`?engine=`) so the next job tries it again. */
export const POST = adminRoute<{ name: string }>(async (req, { name }) => engineProxyFor(req, "POST", `/providers/${encodeURIComponent(name)}/reset`));
