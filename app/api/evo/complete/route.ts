import { NextRequest } from "next/server";
import { fail, json, parseBody } from "@/lib/auth/http";
import { isEngineCall } from "@/lib/evo/engine";
import { promote, promotionInput } from "@/lib/evo/promote";
import { engineIdOfTask } from "@/lib/evo/scheduler";
import { TmdbError } from "@/lib/tmdb";
import { captureException } from "@/lib/errors/capture";

/** Engine -> app: a quality finished caching to the CDN. Registers it as a source (and subtitles). */
export async function POST(req: NextRequest) {
  if (!isEngineCall(req)) return fail(401, "UNAUTHORIZED", "Invalid engine secret");
  const parsed = await parseBody(req, promotionInput);
  if ("error" in parsed) return parsed.error;
  try {
    // The engine names its task; the app knows which engine owns it, so the cached media and subtitles are credited to it.
    await promote(parsed.data, await engineIdOfTask(parsed.data.taskId));
    return json(200, { ok: true });
  } catch (e) {
    if (e instanceof TmdbError) return fail(404, "NOT_FOUND", e.message);
    console.error("evo promote failed", e instanceof Error ? e.message : e);
    await captureException(e, { url: req.nextUrl.pathname, method: "POST", route: "/api/evo/complete", headers: req.headers, tags: { mechanism: "evoComplete", taskId: parsed.data.taskId } });
    return fail(500, "INTERNAL", "Could not register the cached source");
  }
}
