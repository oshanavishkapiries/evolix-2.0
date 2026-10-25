import { fail } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { engineProxyFor } from "@/lib/cms/evo-admin";

/** Pause or resume starting new jobs on one engine (`?engine=`); running ones finish. */
export const POST = adminRoute<{ action: string }>(async (req, { action }) =>
  action === "pause" || action === "resume" ? engineProxyFor(req, "POST", `/queue/${action}`) : fail(404, "NOT_FOUND", "Unknown action"),
);
