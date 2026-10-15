import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    if (!taskId) {
      return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
    }

    const targetUrl = `${env.EVO_ENGINE_URL}/api/v1/media/status/${taskId}`;
    const headers: Record<string, string> = {};
    if (env.EVO_SECRET_TOKEN) {
      headers["X-Evo-Secret"] = env.EVO_SECRET_TOKEN;
    }

    const res = await fetch(targetUrl, {
      method: "GET",
      headers,
      cache: "no-store",
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
