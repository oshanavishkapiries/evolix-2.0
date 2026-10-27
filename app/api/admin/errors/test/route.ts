import { adminRoute } from "@/lib/cms/api";

class EvolixTestError extends Error {
  name = "EvolixTestError";
}

/** Throws on purpose so admins can check that capture, grouping and alerts work end to end. */
export const POST = adminRoute(async () => {
  throw new EvolixTestError("Test error from the admin panel (server)");
});
