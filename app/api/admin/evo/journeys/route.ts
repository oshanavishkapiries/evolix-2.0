import { NextResponse } from "next/server";
import { json } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { adminEngine } from "@/lib/cms/evo-admin";
import { JOURNEY_WINDOWS } from "@/lib/evo/journeys";
import { journeyReport } from "@/lib/evo/overview";

/** What viewers went through, per title: `?hours=24|168` (anything else means 24), and `?engine=<id>` for one engine (default: all engines). */
export const GET = adminRoute(async (req) => {
  const asked = Number(req.nextUrl.searchParams.get("hours"));
  const hours = (JOURNEY_WINDOWS as readonly number[]).includes(asked) ? asked : 24;
  const one = req.nextUrl.searchParams.has("engine") && req.nextUrl.searchParams.get("engine") !== "all";
  const engine = one ? adminEngine(req) : undefined;
  if (engine instanceof NextResponse) return engine;
  return json(200, { report: await journeyReport(hours, engine) });
});
