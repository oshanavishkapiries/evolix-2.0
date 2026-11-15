import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/config", () => ({ getConfig: async () => ({ STREAM_BASE: "https://w.example" }) }));
vi.mock("@/lib/evo/client", () => ({ engines: vi.fn(async () => [{ id: "owner", url: "http://engine" }]), engineFetch: vi.fn() }));
import { engineFetch } from "@/lib/evo/client";
import { engineKey, viewerFileUrl, viewerTaskUrls } from "@/lib/evo/stream-url";
import { localFileId, isLocalPlaybackUrl } from "@/lib/evo/local-file";
import { GET, HEAD } from "@/app/api/evo/file/[engineKey]/[...file]/route";
const id = "f".repeat(64) + ".mp4";
const key = engineKey("owner");
const params = (file = [id], engineKey = key) => ({ params: Promise.resolve({ file, engineKey }) });
const request = (method = "GET") => new NextRequest(`https://app/api/evo/file/${key}/${id}`, { method, headers: { Range: "bytes=1-4", "If-Range": '"one"' } });
afterEach(() => vi.clearAllMocks());

describe("local CDN URL resolution", () => {
  it("selects the owning engine and supports Worker and Next URLs", async () => {
    expect(isLocalPlaybackUrl(`/api/evo/file/${key}/${id}`)).toBe(true);
    expect(isLocalPlaybackUrl(`https://w.example/${key}/file/${id}`)).toBe(true);
    expect(isLocalPlaybackUrl("https://pixeldrain.com/api/file/abcd")).toBe(false);
    expect(await viewerFileUrl(`evo-local://${id}`, "owner", "")).toBe(`/api/evo/file/${key}/${id}`);
    expect(await viewerFileUrl(`evo-local://${id}`, "owner")).toBe(`https://w.example/${key}/file/${id}`);
    expect(await viewerFileUrl(`evo-local://${id}`, "other", "https://w.example/")).toBe(`https://w.example/${engineKey("other")}/file/${id}`);
    expect(await viewerFileUrl("https://pixeldrain.com/api/file/abcd", null)).toBe("https://pixeldrain.com/api/file/abcd");
    await expect(viewerFileUrl(`evo-local://${id}`, null)).rejects.toThrow("owning engine");
  });
  it("rejects traversal, encoding and query strings and resolves completed task URLs", async () => {
    for (const bad of ["evo-local://../a.mp4", `evo-local://${id}?x=y`, "evo-local://%2fetc.mp4", "evo-local://foo.mp4"]) expect(localFileId(bad)).toBeNull();
    const data = await viewerTaskUrls({ result_url: `evo-local://${id}`, cdn_subtitles: [{ url: `evo-local://${id.replace("mp4", "vtt")}` }] }, "owner");
    expect(data.result_url).toBe(`https://w.example/${key}/file/${id}`);
    expect(data.cdn_subtitles).toEqual([{ url: `https://w.example/${key}/file/${id.replace("mp4", "vtt")}` }]);
  });
});

describe("Next local file streaming proxy", () => {
  it("streams ranges without consuming the upstream body and passes only safe headers", async () => {
    const upstream = new Response("part", { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 1-4/100", "Accept-Ranges": "bytes", "Content-Length": "4", "X-Evo-Secret": "private" } });
    const textSpy = vi.spyOn(upstream, "text");
    vi.mocked(engineFetch).mockResolvedValue(upstream);
    const res = await GET(request(), params());
    expect(engineFetch).toHaveBeenCalledWith(`/files/${id}`, expect.objectContaining({ engine: { id: "owner", url: "http://engine" }, method: "GET", headers: { Range: "bytes=1-4", "If-Range": '"one"' } }));
    expect(textSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 1-4/100");
    expect(res.headers.get("X-Evo-Secret")).toBeNull();
    expect(await res.text()).toBe("part");
  });
  it("supports HEAD, missing files and unsatisfiable ranges", async () => {
    vi.mocked(engineFetch).mockResolvedValue(new Response(null, { headers: { "Content-Type": "text/vtt", "Content-Length": "42" } }));
    const head = await HEAD(request("HEAD"), params([id.replace("mp4", "vtt")]));
    expect(head.headers.get("Content-Type")).toBe("text/vtt");
    expect(head.headers.get("Content-Length")).toBe("42");
    expect(await head.text()).toBe("");
    for (const status of [404, 416]) {
      vi.mocked(engineFetch).mockResolvedValue(new Response("private error", { status, headers: { "Content-Range": "bytes */100" } }));
      const res = await GET(request(), params());
      expect(res.status).toBe(status);
      expect(res.headers.get("Content-Range")).toBe("bytes */100");
      expect(await res.text()).toBe("");
    }
  });
  it("rejects path traversal and unknown engines, and hides transport errors", async () => {
    for (const file of [["..", id], ["%2fetc.mp4"], ["a.mp4"], []]) expect((await GET(request(), params(file))).status).toBe(400);
    expect((await GET(request(), params([id], "deadbeef"))).status).toBe(404);
    expect(engineFetch).not.toHaveBeenCalled();
    vi.mocked(engineFetch).mockRejectedValue(new Error("secret=http://private-engine"));
    const res = await GET(request(), params());
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("secret");
  });
});
