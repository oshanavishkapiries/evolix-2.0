import { revalidateTag } from "next/cache";
import { json, parseBody } from "@/lib/auth/http";
import { subtitleRoute } from "@/lib/subtitles/http";
import { activityInput } from "@/lib/subtitles/schema";
import { accessibleTrack, recordActivity } from "@/lib/subtitles/store";
import { CATALOG_TAG } from "@/lib/viewer/cache";

export const POST = subtitleRoute(async (req, userId) => {
  const parsed = await parseBody(req, activityInput);
  if ("error" in parsed) return parsed.error;
  const a = parsed.data;
  if (!await accessibleTrack(a.trackId, userId)) return json(404, { message: "Subtitle not found" });
  const outcome = await recordActivity(userId, a.trackId, a.action, a.action === "report" ? a.reason : undefined, a.action === "start" || a.action === "played" ? a.playId : undefined);
  // Scores re-rank on the normal cache refresh. Only a report that hides the track needs the catalog expired now.
  if (a.action === "report" && outcome === true) revalidateTag(CATALOG_TAG, { expire: 0 });
  return json(200, { ...(a.action === "played" ? { credited: outcome === true } : {}) });
}, 120);
