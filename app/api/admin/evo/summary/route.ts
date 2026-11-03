import { NextResponse } from "next/server";
import { fail, json } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { adminEngine } from "@/lib/cms/evo-admin";
import { combinedSummary } from "@/lib/evo/overview";

/** Per-step outcome counts for the overview graph: one engine (`?engine=<id>`), every engine (`?engine=all`), or the primary. */
export const GET = adminRoute(async (req) => {
  const all = req.nextUrl.searchParams.get("engine") === "all";
  const engine = all ? undefined : (await adminEngine(req));
  if (engine instanceof NextResponse) return engine;
  const summary = await combinedSummary(engine);
  return summary ? json(200, { summary }) : fail(502, "ENGINE_UNAVAILABLE", "The Evo engine did not answer");
});
