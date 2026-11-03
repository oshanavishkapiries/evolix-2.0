import { NextRequest } from "next/server";
import { z } from "zod";
import { clientInfo, fail, json } from "@/lib/auth/http";
import { userFromHeaders } from "@/lib/errors/capture";
import { scrubHeaders } from "@/lib/errors/scrub";
import { parseStack } from "@/lib/errors/stack";
import { recordError } from "@/lib/errors/store";
import { symbolicate } from "@/lib/errors/symbolicate";
import { isEngineCall } from "@/lib/evo/engine";

const MAX_BODY = 100_000;
const PER_MINUTE = 30;

const crumb = z.object({
  t: z.number(),
  type: z.enum(["nav", "click", "fetch", "console", "log"]),
  message: z.string().max(1000),
  level: z.enum(["info", "warning", "error"]).optional(),
});

const report = z.object({
  type: z.string().max(200).default("Error"),
  message: z.string().max(5000),
  stack: z.string().max(50_000).default(""),
  level: z.enum(["error", "warning", "fatal"]).default("error"),
  url: z.string().max(4000).optional(),
  route: z.string().max(500).optional(),
  method: z.string().max(10).optional(),
  breadcrumbs: z.array(crumb).max(60).default([]),
  context: z.record(z.string(), z.unknown()).default({}),
  /** Engine only: Python frames, already resolved. */
  frames: z
    .array(
      z.object({
        fn: z.string().max(300),
        file: z.string().max(500),
        line: z.number().nullable(),
        col: z.number().nullable().default(null),
        inApp: z.boolean(),
        context: z.object({ start: z.number(), lines: z.array(z.string().max(400)).max(21) }).optional(),
      }),
    )
    .max(80)
    .optional(),
});

// Per-IP fixed window; a page that loops on an error must not flood the database.
const hits = new Map<string, { at: number; n: number }>();
function limited(key: string) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.at > 60_000) {
    hits.set(key, { at: now, n: 1 });
    if (hits.size > 5000) hits.delete(hits.keys().next().value!);
    return false;
  }
  return ++h.n > PER_MINUTE;
}

/** Error reports from browsers (same origin) and from Evo engines (X-Evo-Secret). Answers 202 whatever happens. */
export async function POST(req: NextRequest) {
  const engine = (await isEngineCall(req));
  if (!engine) {
    // Browsers only: reject cross-site posts so other sites cannot fill the error log.
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && host && new URL(origin).host !== host) return fail(403, "FORBIDDEN", "Cross-origin report");
  }
  const { ip, userAgent } = clientInfo(req);
  if (!engine && limited(ip ?? "unknown")) return json(429, { ok: false });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return fail(413, "TOO_LARGE", "Report too large");

  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return fail(413, "TOO_LARGE", "Report too large");
    raw = JSON.parse(text);
  } catch {
    return fail(400, "BAD_JSON", "Invalid JSON");
  }
  const parsed = report.safeParse(raw);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid report");
  const r = parsed.data;

  try {
    const user = engine ? null : await userFromHeaders(req.headers).catch(() => null);
    let route = r.route ?? null;
    if (!route && r.url) {
      try {
        route = new URL(r.url).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}|\d+/gi, ":id");
      } catch {}
    }
    await recordError({
      source: engine ? "engine" : "client",
      type: r.type,
      message: r.message,
      stack: r.stack,
      frames: r.frames ?? symbolicate(parseStack(r.stack)),
      level: r.level,
      url: r.url,
      method: r.method,
      route,
      userId: user?.userId,
      userEmail: user?.email,
      userAgent: engine ? undefined : userAgent,
      breadcrumbs: r.breadcrumbs,
      context: { ...r.context, ip, headers: scrubHeaders(req.headers) },
    });
  } catch (e) {
    console.error("[errors] ingest failed:", e instanceof Error ? e.message : e);
  }
  return json(202, { ok: true });
}
