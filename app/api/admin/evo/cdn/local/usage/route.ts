import { NextResponse } from "next/server";
import { json } from "@/lib/auth/http";
import { adminRoute } from "@/lib/cms/api";
import { adminEngine, engineProxy } from "@/lib/cms/evo-admin";

const usageJson = (data: unknown) => {
  const response = json(200, { data });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

/** Read the actual running provider, including engines still using environment defaults. */
export const GET = adminRoute(async (req) => {
  const engine = await adminEngine(req);
  if (engine instanceof NextResponse) return engine;
  const config = await engineProxy("GET", "/config", undefined, engine);
  if (!config.ok) return config;
  const { data: settings } = await config.json() as { data: { key: string; value: unknown }[] };
  const provider = settings.find((s) => s.key === "CDN_PROVIDER")?.value;
  // Older engines only support Pixeldrain and have no local usage endpoint.
  if (provider === undefined) return usageJson({ provider: "pixeldrain" });
  if (provider !== "local" && provider !== "pixeldrain") {
    return usageJson({ provider: "unknown" });
  }
  const usage = await engineProxy("GET", "/cdn/local/usage", undefined, engine);
  if (!usage.ok) return usage;
  const { data } = await usage.json();
  return usageJson({ ...data, provider });
});
