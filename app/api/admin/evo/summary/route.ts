import { fail, json } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { engineSummary } from "@/lib/cms/evo";

/** Per-step outcome counts for the overview graph. */
export const GET = adminRoute(async () => {
  const summary = await engineSummary();
  return summary ? json(200, { summary }) : fail(502, "ENGINE_UNAVAILABLE", "The Evo engine did not answer");
});
