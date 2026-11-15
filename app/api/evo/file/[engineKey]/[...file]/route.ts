import { NextRequest, NextResponse } from "next/server";
import { engineFetch, engines } from "@/lib/evo/client";
import { engineKey } from "@/lib/evo/stream-url";
import { LOCAL_FILE_ID } from "@/lib/evo/local-file";

// Like /api/evo/stream, the opaque file id is a playback capability. Session expiry must not interrupt playback.
async function proxy(req: NextRequest, { params }: { params: Promise<{ engineKey: string; file: string[] }> }) {
  const { engineKey: key, file } = await params;
  if (!/^[0-9a-f]{8}$/i.test(key) || file?.length !== 1 || !LOCAL_FILE_ID.test(file[0])) {
    return new NextResponse("Invalid file path", { status: 400 });
  }
  try {
    const engine = (await engines()).find((e) => engineKey(e.id) === key.toLowerCase());
    if (!engine) return new NextResponse("File source not found", { status: 404 });
    const headers: Record<string, string> = {};
    for (const name of ["Range", "If-Range"]) {
      const value = req.headers.get(name);
      if (value) headers[name] = value;
    }
    const res = await engineFetch(`/files/${file[0]}`, { engine, method: req.method as "GET" | "HEAD", headers, timeoutMs: 30_000 });
    const out = new Headers({ "Cache-Control": res.ok ? "private, max-age=3600" : "no-store" });
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = res.headers.get(name);
      if (value) out.set(name, value);
    }
    if (!res.ok) out.delete("content-length");
    if (!res.ok || req.method === "HEAD") await res.body?.cancel().catch(() => {});
    return new NextResponse(res.ok && req.method !== "HEAD" ? res.body : null, { status: res.status, headers: out });
  } catch {
    return new NextResponse("File source unreachable", { status: 502 });
  }
}
export { proxy as GET, proxy as HEAD };
