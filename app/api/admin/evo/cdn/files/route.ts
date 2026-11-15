import { NextResponse } from "next/server";
import { json } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { adminEngine, engineProxy } from "@/lib/cms/evo-admin";
import { viewerFileUrl } from "@/lib/evo/stream-url";

/** Keep storage URLs for deletion/matching and supply playable links for local files. */
export const GET = adminRoute(async (req) => {
  const engine = await adminEngine(req);
  if (engine instanceof NextResponse) return engine;
  const res = await engineProxy("GET", "/cdn/files", undefined, engine);
  if (!res.ok) return res;
  const { data } = await res.json() as { data: { url: string }[] };
  return json(200, { data: await Promise.all(data.map(async (file) => ({ ...file, playbackUrl: await viewerFileUrl(file.url, engine.id) }))) });
});
