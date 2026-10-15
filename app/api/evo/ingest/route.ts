import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { tmdbId, mediaType = "movie", quality = "1080p" } = body;

    if (!tmdbId) {
      return NextResponse.json({ error: "Missing tmdbId" }, { status: 400 });
    }

    const targetUrl = `${env.EVO_ENGINE_URL}/api/v1/media/ingest`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (env.EVO_SECRET_TOKEN) {
      headers["X-Evo-Secret"] = env.EVO_SECRET_TOKEN;
    }

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tmdb_id: Number(tmdbId),
        media_type: mediaType,
        quality,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Evo-Engine returned ${res.status}: ${errText}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to connect to Evo-Engine";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
