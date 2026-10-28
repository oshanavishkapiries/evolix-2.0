import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, json, parseBody } from "@/lib/auth/http";
import { captureException } from "@/lib/errors/capture";
import { startIngest } from "@/lib/evo/ingest";
import { allow, release, viewerId } from "@/lib/evo/guard";
import { newRef, PROBLEMS } from "@/lib/evo/problems";
import { QUALITIES } from "@/lib/evo/promote";
import { TmdbError } from "@/lib/tmdb";
import { canWatch } from "@/lib/viewer/access";

const body = z
  .object({
    tmdbId: z.number().int().positive(),
    mediaType: z.enum(["movie", "tv"]).default("movie"),
    quality: z.enum(QUALITIES).default("720p"),
    season: z.number().int().min(0).max(10_000).optional(),
    episode: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((b) => b.mediaType === "movie" || (b.season !== undefined && b.episode !== undefined), "season and episode are required for tv");

const INGESTS_PER_WINDOW = 12;
const WINDOW_MS = 10 * 60_000;

/** Starts (or joins) an engine task. Signed-in only; the title is checked against TMDB and given a catalog row first. */
export async function POST(req: NextRequest) {
  const userId = await viewerId(req);
  if (!userId) return fail(401, "UNAUTHORIZED", "Not authenticated");
  if (!(await canWatch(userId))) return fail(403, "ACCOUNT_PENDING", "Your account is waiting for admin approval");
  const limitKey = `ingest:${userId}`;
  if (!allow(limitKey, INGESTS_PER_WINDOW, WINDOW_MS)) return fail(429, "RATE_LIMITED", PROBLEMS.RATE_LIMITED.message, { title: PROBLEMS.RATE_LIMITED.title, retryAfter: 60 });
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const { tmdbId, mediaType, quality, season, episode } = parsed.data;

  try {
    const out = await startIngest({ tmdbId, mediaType, quality, season, episode });
    if (out.kind === "not_found") return fail(404, "NOT_FOUND", out.message);
    if (out.kind === "error") {
      // The raw engine text is for us, not the viewer: keep it in the error tracker and send the friendly version.
      const { detail, ...body } = out.body as { detail?: string; code?: string; retryAfter?: number };
      if (body.code === "BUSY") {
        // Being turned away because we are full is not the viewer's doing: it must not count against their allowance.
        release(limitKey);
        const res = json(out.status, body);
        res.headers.set("Retry-After", String(body.retryAfter ?? PROBLEMS.BUSY.retryAfter));
        return res;
      }
      if (body.code === "UNKNOWN") {
        const ref = newRef();
        await captureException(new Error(detail ?? "Ingest failed"), { url: req.nextUrl.pathname, method: req.method, headers: req.headers, level: "warning", tags: { ref, tmdbId, mediaType } });
        return json(out.status, { ...body, ref });
      }
      return json(out.status, body);
    }
    return json(200, out.data);
  } catch (e) {
    if (e instanceof TmdbError) return fail(404, "NOT_FOUND", "Title not found");
    throw e;
  }
}
