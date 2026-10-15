import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string; path: string[] }> }
) {
  try {
    const { taskId, path } = await params;
    if (!taskId || !path || path.length === 0) {
      return new NextResponse("Invalid stream path", { status: 400 });
    }

    const subPath = path.join("/");
    const search = req.nextUrl.search;
    const targetUrl = `${env.EVO_ENGINE_URL}/api/v1/media/stream/${taskId}/${subPath}${search}`;

    const headers: Record<string, string> = {};
    if (env.EVO_SECRET_TOKEN) {
      headers["X-Evo-Secret"] = env.EVO_SECRET_TOKEN;
    }
    const range = req.headers.get("range");
    if (range) {
      headers["Range"] = range;
    }

    const res = await fetch(targetUrl, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (!res.ok) {
      return new NextResponse(`Stream error: ${res.status}`, { status: res.status });
    }

    const isPlaylist = subPath.endsWith(".m3u8");
    if (isPlaylist) {
      let text = await res.text();
      // Rewrite internal engine base paths to the Next.js proxy path
      text = text.replaceAll(`/api/v1/media/stream/${taskId}`, `/api/evo/stream/${taskId}`);
      return new NextResponse(text, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Binary media chunk (video/mp2t or video/mp4)
    const blob = await res.arrayBuffer();
    const contentType = res.headers.get("Content-Type") || "video/mp2t";

    return new NextResponse(blob, {
      status: res.status,
      headers: {
        "Content-Type": contentType.startsWith("text/") ? "video/mp2t" : contentType,
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Stream proxy error";
    return new NextResponse(msg, { status: 502 });
  }
}

export async function HEAD(
  req: NextRequest,
  props: { params: Promise<{ taskId: string; path: string[] }> }
) {
  return GET(req, props);
}
