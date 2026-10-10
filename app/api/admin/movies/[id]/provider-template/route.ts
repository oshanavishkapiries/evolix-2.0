import { z } from "zod";
import { adminRoute, isUuid, notFound, parseQuery } from "@/lib/cms/api";
import { loadMovieTemplate, templateResponse } from "@/lib/cms/provider-io";

type P = { id: string };
const query = z.object({ format: z.enum(["csv", "json"]).default("csv") });

/** Download: this movie's structure with its current sources and subtitles, ready to fill in. */
export const GET = adminRoute<P>(async (req, { id }) => {
  const q = parseQuery(req, query);
  if ("error" in q) return q.error;
  const template = isUuid(id) ? await loadMovieTemplate(id) : null;
  return template ? templateResponse(template, q.data.format) : notFound("Movie");
});
