import { NextResponse } from "next/server";
import { engineFetch, engines } from "@/lib/evo/client";
import { subtitleOwner } from "@/lib/evo/scheduler";

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
    if (!/^sub_\d+_[a-z]{2,3}_\d+(\.vtt)?$/.test(subId)) return new NextResponse("Invalid subtitle ID", { status: 400 });

    // The engine that fetched the track holds it; a track we never saw is looked for on each engine in turn.
    const owner = await subtitleOwner(subId.replace(/\.vtt$/, ""));
    let res = await engineFetch(`/subtitles/${cleanId}`, { engine: owner ?? undefined });
    if (!owner && res.status === 404) {
      for (const engine of engines().slice(1)) {
        const next = await engineFetch(`/subtitles/${cleanId}`, { engine }).catch(() => null);
        if (next?.ok) {
          res = next;
          break;
        }
      }
    }

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
