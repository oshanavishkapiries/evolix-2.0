import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const origin = "https://evolix.test";
const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

class AssetResponse {
  constructor(readonly body = "chunk", readonly ok = true, readonly type = "basic") {}
  clone() { return new AssetResponse(this.body, this.ok, this.type); }
}

type WorkerEvent = {
  request?: Request;
  respondWith: ReturnType<typeof vi.fn>;
  waitUntil: ReturnType<typeof vi.fn>;
};

function setup() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const stores = new Map<string, Map<string, AssetResponse>>();
  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name)!;
    return {
      match: vi.fn(async (request: Request) => entries.get(request.url)?.clone()),
      put: vi.fn(async (request: Request, response: AssetResponse) => { entries.set(request.url, response); }),
      keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
      delete: vi.fn(async (request: Request) => entries.delete(request.url)),
    };
  };
  const caches = {
    open: vi.fn(async (name: string) => cacheFor(name)),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => stores.delete(name)),
  };
  const fetch = vi.fn<(request: Request) => Promise<AssetResponse>>(async () => new AssetResponse());
  const self = {
    location: { origin },
    addEventListener: (name: string, listener: (event: WorkerEvent) => void) => listeners.set(name, listener),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  runInNewContext(source, { self, caches, fetch, URL });

  const dispatch = (name: string, request?: Request) => {
    const event: WorkerEvent = { request, respondWith: vi.fn(), waitUntil: vi.fn() };
    listeners.get(name)!(event);
    return event;
  };
  const request = (path: string, init?: RequestInit) => new Request(new URL(path, origin), init);
  const retrieve = async (path: string) => {
    const event = dispatch("fetch", request(path));
    expect(event.respondWith).toHaveBeenCalledOnce();
    const response = await event.respondWith.mock.calls[0][0] as AssetResponse;
    // Background cache writes are extended through waitUntil, like a real worker lifetime.
    await Promise.all(event.waitUntil.mock.calls.map(([work]) => work));
    return response;
  };
  return { stores, caches, fetch, self, dispatch, request, retrieve };
}

describe("static service worker", () => {
  it.each(["/_next/static/chunks/abc123.js", "/_next/static/css/abc123.css", "/fonts/body.woff2", "/fonts/body.ttf"])(
    "caches %s on its first fetch and reuses it on the second", async (path) => {
      const sw = setup();
      expect((await sw.retrieve(path)).body).toBe("chunk");
      expect((await sw.retrieve(path)).body).toBe("chunk");
      expect(sw.fetch).toHaveBeenCalledOnce();
      expect([...sw.stores.keys()]).toEqual(["evolix-static-v1"]);
    },
  );

  it("never intercepts requests outside the explicit static policy, even if already cached", async () => {
    const sw = setup();
    const chunk = "/_next/static/chunks/abc123.js";
    await sw.retrieve(chunk);
    const navigation = sw.request(chunk);
    Object.defineProperty(navigation, "mode", { value: "navigate" });
    const requests = [
      navigation,
      sw.request("/dashboard"),
      sw.request("/dashboard?_rsc=123"),
      sw.request(`${chunk}?_rsc=`),
      sw.request(chunk, { headers: { RSC: "1" } }),
      sw.request(chunk, { headers: { "Next-Router-State-Tree": "[]" } }),
      sw.request(chunk, { headers: { "Next-Router-Prefetch": "1" } }),
      sw.request("/api/font.woff2"),
      sw.request("/api"),
      sw.request("/watch/font.woff2"),
      ...["m3u8", "ts", "mp4", "vtt"].map((extension) => sw.request(`/_next/static/video.${extension}?token=1`)),
      sw.request("https://image.tmdb.org/t/p/w500/poster.jpg"),
      sw.request("https://cdn.example.test/_next/static/chunks/abc.js"),
      sw.request("https://cdn.example.test/font.woff2"),
      sw.request(chunk, { headers: { Range: "bytes=0-100" } }),
      sw.request(chunk, { method: "POST" }),
      sw.request(chunk, { method: "HEAD" }),
      sw.request("/poster.jpg"),
    ];
    sw.fetch.mockClear();
    sw.caches.open.mockClear();
    for (const request of requests) {
      const event = sw.dispatch("fetch", request);
      expect(event.respondWith, request.url).not.toHaveBeenCalled();
    }
    expect(sw.fetch).not.toHaveBeenCalled();
    expect(sw.caches.open).not.toHaveBeenCalled();
  });

  it("skips waiting and removes only older Evolix caches before claiming clients", async () => {
    const sw = setup();
    for (const name of ["evolix-static-v0", "evolix-images-old", "evolix-static-v1", "other-app"]) {
      sw.stores.set(name, new Map());
    }
    const install = sw.dispatch("install");
    await install.waitUntil.mock.calls[0][0];
    expect(sw.self.skipWaiting).toHaveBeenCalledOnce();
    const activate = sw.dispatch("activate");
    await activate.waitUntil.mock.calls[0][0];
    expect([...sw.stores.keys()]).toEqual(["evolix-static-v1", "other-app"]);
    expect(sw.self.clients.claim).toHaveBeenCalledOnce();
  });

  it("trims oldest entries to 400, including concurrent writes", async () => {
    const sw = setup();
    await sw.retrieve("/_next/static/oldest.js");
    const entries = sw.stores.get("evolix-static-v1")!;
    for (let i = 1; i < 400; i++) {
      entries.set(`${origin}/_next/static/chunk-${i}.js`, new AssetResponse());
    }
    await Promise.all(Array.from({ length: 10 }, (_, i) => sw.retrieve(`/_next/static/new-${i}.js`)));
    expect(entries.size).toBe(400);
    expect(entries.has(`${origin}/_next/static/oldest.js`)).toBe(false);
    expect(entries.has(`${origin}/_next/static/chunk-9.js`)).toBe(false);
    expect(entries.has(`${origin}/_next/static/chunk-10.js`)).toBe(true);
    expect(entries.has(`${origin}/_next/static/new-9.js`)).toBe(true);
  });

  it.each([[false, "basic"], [true, "opaque"], [true, "cors"]])(
    "does not store a response with ok=%s and type=%s", async (ok, type) => {
      const sw = setup();
      sw.fetch.mockResolvedValue(new AssetResponse("uncached", ok as boolean, type as string));
      await sw.retrieve("/_next/static/chunk.js");
      await sw.retrieve("/_next/static/chunk.js");
      expect(sw.fetch).toHaveBeenCalledTimes(2);
      expect(sw.stores.get("evolix-static-v1")!.size).toBe(0);
    },
  );

  it("serves the network response when cache storage is unavailable", async () => {
    const sw = setup();
    sw.caches.open.mockRejectedValue(new Error("storage disabled"));
    expect((await sw.retrieve("/_next/static/chunk.js")).body).toBe("chunk");
    expect(sw.fetch).toHaveBeenCalledOnce();
  });

  it("serves the network response after quota failures and allows subsequent writes", async () => {
    const sw = setup();
    const cache = await sw.caches.open("evolix-static-v1");
    cache.put.mockRejectedValueOnce(new Error("quota exceeded"));
    sw.caches.open.mockResolvedValue(cache);
    expect((await sw.retrieve("/_next/static/first.js")).body).toBe("chunk");
    await sw.retrieve("/_next/static/second.js");
    await sw.retrieve("/_next/static/second.js");
    expect(sw.fetch).toHaveBeenCalledTimes(2);
  });
});
