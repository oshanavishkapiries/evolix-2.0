import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ subId: string }> }
) {
  try {
    const { subId } = await params;
    if (!subId) {
      return new NextResponse("Missing subtitle ID", { status: 400 });
    }

    const cleanId = subId.endsWith(".vtt") ? subId : `${subId}.vtt`;
    const targetUrl = `${env.EVO_ENGINE_URL}/api/v1/media/subtitles/${cleanId}`;

    const headers: Record<string, string> = {};
    if (env.EVO_SECRET_TOKEN) {
      headers["X-Evo-Secret"] = env.EVO_SECRET_TOKEN;
    }

    const res = await fetch(targetUrl, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      return new NextResponse(`Subtitle not found: ${res.status}`, { status: res.status });
    }

    const text = await res.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Subtitle proxy error";
    return new NextResponse(msg, { status: 502 });
  }
}
