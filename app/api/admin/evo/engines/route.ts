import { json } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { enginesOverview } from "@/lib/evo/overview";

/** Every configured engine with availability, last good health check, load, disk and failures. */
export const GET = adminRoute(async () => json(200, { engines: await enginesOverview() }));
