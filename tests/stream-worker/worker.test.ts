import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../tools/stream-worker/src/index";
import { engineIdFor, engineKey, parseEngines, parsePath, rewritePlaylist } from "../../tools/stream-worker/src/core";
import { engineKey as appKey } from "@/lib/evo/stream-url";
import { engineIdFor as appId, parseEngines as appParse } from "@/lib/evo/client";
import { viewerStreamUrl } from "@/lib/evo/stream-url";

const TASK = "0b7c1a2e-5d3f-4a6b-8c9d-1e2f3a4b5c6d";
const ENGINE = "http://169-58-244-90.sslip.io:8000";
const SITE = "https://evolix-mu.vercel.app";
const env = { EVO_ENGINES: JSON.stringify([ENGINE, "http://other.example"]), EVO_SECRET_TOKEN: "s3cret", ALLOWED_ORIGINS: SITE };

const keyOf = async (url: string) => engineKey(engineIdFor(url));
const call = async (path: string, init: RequestInit = {}, e = env) => worker.fetch(new Request(`https://w.example${path}`, init), e);
const stubEngine = (res: Response | (() => Response)) => {
  const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => (typeof res === "function" ? res() : res));
  vi.stubGlobal("fetch", f);
  return f;
};
afterEach(() => vi.unstubAllGlobals());

describe("the Worker and the app agree", () => {
  it("derive the same engine id and the same public key", async () => {
    for (const url of [ENGINE, "http://38-242-251-70.sslip.io", "https://x.example/base/"]) {
      expect(engineIdFor(url.replace(/\/+$/, ""))).toBe(appId(url.replace(/\/+$/, "")));
      expect(await keyOf(url.replace(/\/+$/, ""))).toBe(appKey(appId(url.replace(/\/+$/, ""))));
    }
  });
  it("reads EVO_ENGINES the way the app does", async () => {
    const list = JSON.stringify([ENGINE, { url: "http://b.example/", name: "B" }]);
    expect((await parseEngines(list)).map((e) => e.url)).toEqual(appParse(list).map((e) => e.url));
  });
});

describe("viewerStreamUrl (app side)", () => {
  const rel = `/api/v1/media/stream/${TASK}/master.m3u8`;
  it("is unchanged without STREAM_BASE, so the Vercel proxy keeps working", async () => {
    expect(await viewerStreamUrl(rel, "e", "")).toBe(rel);
    expect(await viewerStreamUrl(null, "e", "https://w.example")).toBeNull();
    expect(await viewerStreamUrl("https://cdn.example/x.mp4", "e", "https://w.example")).toBe("https://cdn.example/x.mp4");
  });
  it("points at the Worker with the engine's short key", async () => {
    expect(await viewerStreamUrl(rel, "some-engine", "https://w.example")).toBe(`https://w.example/${appKey("some-engine")}/${TASK}/master.m3u8`);
  });
});

describe("what the Worker will serve", () => {
  it("accepts only master, variant and segment of a real task", () => {
    expect(parsePath(`/abcd1234/${TASK}/master.m3u8`)).toMatchObject({ file: "master.m3u8" });
    for (const bad of ["/", "/health", `/abcd1234/${TASK}/status`, `/abcd1234/${TASK}/../tasks`, `/abcd1234/not-a-task/master.m3u8`, `/zz/${TASK}/segment`, `/abcd1234/${TASK}/segment/x`]) expect(parsePath(bad)).toBeNull();
  });
  it("rewrites only that task's engine paths in a playlist", () => {
    const text = `#EXTM3U\n/api/v1/media/stream/${TASK}/segment?url=u&sig=s\n/api/v1/media/stream/other/segment`;
    expect(rewritePlaylist(text, TASK, "abcd1234")).toBe(`#EXTM3U\n/abcd1234/${TASK}/segment?url=u&sig=s\n/api/v1/media/stream/other/segment`);
  });
});

describe("requests", () => {
  it("refuses unknown paths and engines without contacting any engine", async () => {
    const f = stubEngine(new Response("x"));
    expect((await call("/api/v1/media/tasks")).status).toBe(404);
    expect((await call(`/deadbeef/${TASK}/master.m3u8`)).status).toBe(404);
    expect((await call(`/${await keyOf(ENGINE)}/${TASK}/master.m3u8`, { method: "POST" })).status).toBe(405);
    expect(f).not.toHaveBeenCalled();
  });

  it("fetches a playlist from the engine with the secret, and rewrites its links to itself", async () => {
    const key = await keyOf(ENGINE);
    const f = stubEngine(new Response(`#EXTM3U\n/api/v1/media/stream/${TASK}/segment?url=a&sig=b\n`, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } }));
    const res = await call(`/${key}/${TASK}/master.m3u8`, { headers: { Origin: SITE } });
    expect(f.mock.calls[0][0]).toBe(`${ENGINE}/api/v1/media/stream/${TASK}/master.m3u8`);
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "X-Evo-Secret": "s3cret" });
    expect(await res.text()).toBe(`#EXTM3U\n/${key}/${TASK}/segment?url=a&sig=b\n`);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(SITE);
  });

  it("passes a segment through with its range headers, and never leaks the secret to the browser", async () => {
    const key = await keyOf(ENGINE);
    const f = stubEngine(new Response("BYTES", { status: 206, headers: { "Content-Type": "video/mp2t", "Content-Range": "bytes 0-4/100", "Accept-Ranges": "bytes", "X-Evo-Secret": "s3cret" } }));
    const res = await call(`/${key}/${TASK}/segment?url=u&sig=s`, { headers: { Range: "bytes=0-4", Origin: SITE } });
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Range: "bytes=0-4" });
    expect(f.mock.calls[0][0]).toBe(`${ENGINE}/api/v1/media/stream/${TASK}/segment?url=u&sig=s`);
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("BYTES");
    expect(res.headers.get("Content-Range")).toBe("bytes 0-4/100");
    expect(res.headers.get("Content-Type")).toBe("video/mp2t");
    expect([...res.headers].join(" ")).not.toContain("s3cret");
  });

  it("does not let another site play from it in a browser", async () => {
    const key = await keyOf(ENGINE);
    stubEngine(new Response("x"));
    const res = await call(`/${key}/${TASK}/segment?url=u&sig=s`, { headers: { Origin: "https://evil.example" } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers the browser's preflight", async () => {
    const res = await call(`/x`, { method: "OPTIONS", headers: { Origin: SITE } });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Range");
  });

  it("passes the engine's status on, and says 502 when the engine is unreachable", async () => {
    const key = await keyOf(ENGINE);
    stubEngine(new Response("no", { status: 403 }));
    expect((await call(`/${key}/${TASK}/segment?url=u&sig=bad`)).status).toBe(403);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("connect failed"); }));
    expect((await call(`/${key}/${TASK}/master.m3u8`)).status).toBe(502);
  });
});
