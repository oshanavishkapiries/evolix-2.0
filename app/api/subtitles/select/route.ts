import { z } from "zod";
import { json, parseBody } from "@/lib/auth/http";
import { engineById } from "@/lib/evo/client";
import { subtitleRoute } from "@/lib/subtitles/http";
import { readCandidate } from "@/lib/subtitles/candidates";
import { publicTrack } from "@/lib/subtitles/store";
import { downloadTrack, HiddenSubtitleError } from "@/lib/subtitles/service";
import { captureException } from "@/lib/errors/capture";
import { PROBLEMS } from "@/lib/evo/problems";
import { invalidateCatalogParent } from "@/lib/cms/catalog-invalidation";

export const POST = subtitleRoute(async (req, userId) => {
  const body = await parseBody(req, z.object({ ref: z.string().max(8000) }));
  if ("error" in body) return body.error;
  const choice = await readCandidate(body.data.ref, userId);
  if (!choice) return json(400, { message: "This choice expired. Search again." });
  const engine = (await engineById(choice.engineId));
  if (!engine) return json(503, { message: "This subtitle server is unavailable" });
  try {
    const track = await downloadTrack(choice.target, engine, choice.providerRef, choice.lang, choice.label, "opensubtitles");
    await invalidateCatalogParent(track);
    return json(200, { track: publicTrack(track, userId) });
  } catch (e) {
    // A hidden release already has a plain message; anything else is provider trouble the viewer cannot act on.
    if (e instanceof HiddenSubtitleError) return json(422, { code: "SUBTITLES", message: e.message });
    await captureException(e, { url: req.nextUrl.pathname, method: req.method, headers: req.headers, level: "warning", tags: { provider: "opensubtitles" } });
    return json(422, { code: "SUBTITLES", title: PROBLEMS.SUBTITLES.title, message: PROBLEMS.SUBTITLES.message });
  }
}, 10);
