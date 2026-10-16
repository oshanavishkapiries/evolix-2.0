import { fail } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { engineProxy } from "@/lib/cms/evo-admin";

/** Pause or resume starting new jobs (running ones finish). */
export const POST = adminRoute<{ action: string }>(async (_req, { action }) =>
  action === "pause" || action === "resume" ? engineProxy("POST", `/queue/${action}`) : fail(404, "NOT_FOUND", "Unknown action"),
);
