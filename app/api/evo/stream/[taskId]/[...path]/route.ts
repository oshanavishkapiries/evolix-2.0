import { NextRequest, NextResponse } from "next/server";
import { engineFetch } from "@/lib/evo/client";
import { engineForTask } from "@/lib/evo/scheduler";

// The task id is an unguessable capability handed only to signed-in viewers (ingest/status require a session).
// Segments are deliberately not tied to the access cookie: it expires after an hour, mid-movie.
const TASK_ID = /^[0-9a-f-]{36}$/i;
const PASS = ["content-type", "content-length", "content-range", "accept-ranges"];

async function proxy(req: NextRequest, { params }: { params: Promise<{ taskId: string; path: string[] }> }) {
  const { taskId, path } = await params;
  if (!TASK_ID.test(taskId) || !path?.length) return new NextResponse("Invalid stream path", { status: 400 });

  const subPath = path.join("/");
  const headers: Record<string, string> = {};
  const range = req.headers.get("range");
  if (range) headers["Range"] = range;

  try {
    // The engine answers within the timeout; the body (a segment) then streams through without a deadline.
    const engine = await engineForTask(taskId); // the engine that owns the task serves all of its playlists and segments
    const res = await engineFetch(`/stream/${taskId}/${subPath}${req.nextUrl.search}`, {
      engine,
      method: req.method as "GET" | "HEAD",
      headers,
      timeoutMs: 30_000,
    });
    if (!res.ok && res.status !== 206) return new NextResponse(`Stream error: ${res.status}`, { status: res.status });

    if (subPath.endsWith(".m3u8")) {
      // Point the playlist's child URLs back at this proxy instead of the engine.
      const text = (await res.text()).replaceAll(`/api/v1/media/stream/${taskId}`, `/api/evo/stream/${taskId}`);
      return new NextResponse(text, {
        status: 200,
        headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache, no-store, must-revalidate" },
      });
    }

    const out = new Headers({ "Cache-Control": "private, max-age=300" });
    for (const h of PASS) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    if (!out.get("content-type") || out.get("content-type")!.startsWith("text/")) out.set("content-type", "video/mp2t");
    // Pipe the body through instead of buffering whole segments in memory.
    return new NextResponse(req.method === "HEAD" ? null : res.body, { status: res.status, headers: out });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "Stream proxy error", { status: 502 });
  }
}

export { proxy as GET, proxy as HEAD };
