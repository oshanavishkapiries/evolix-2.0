import { createHash } from "node:crypto";
import { getConfig } from "@/lib/config";

/** Short public id of an engine; the stream Worker derives the same one (tools/stream-worker/src/core.ts). */
export const engineKey = (engineId: string) => createHash("sha256").update(engineId).digest("hex").slice(0, 8);

const ENGINE_STREAM = /^\/api\/v1\/media\/stream\/([0-9a-f-]{36})\//i;

/**
 * The stream URL a viewer's player should use. With STREAM_BASE set, an engine's relative stream path becomes an
 * address on the stream Worker; otherwise (or for anything unrecognised) it is returned unchanged and the player
 * keeps using this app's own /api/evo/stream proxy, exactly as before.
 */
export async function viewerStreamUrl(streamUrl: unknown, engineId: string, base?: string): Promise<unknown> {
  base ??= (await getConfig()).STREAM_BASE;
  if (!base || typeof streamUrl !== "string") return streamUrl;
  const m = ENGINE_STREAM.exec(streamUrl);
  if (!m) return streamUrl;
  return `${base}/${engineKey(engineId)}/${m[1].toLowerCase()}/${streamUrl.slice(m[0].length)}`;
}
