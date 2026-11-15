// Public files are served verbatim (NEXT_PUBLIC_RELEASE is not injected here).
// Bump this version when changing cache policy or replacing un-hashed local fonts.
const STATIC_CACHE = "evolix-static-v1";
const MAX_ENTRIES = 400;
let pendingWrite = Promise.resolve();

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("evolix-") && name !== STATIC_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function cacheFirst(event) {
  const { request } = event;
  // Storage may be unavailable or full; a cache failure must not break a static asset.
  const cache = await caches.open(STATIC_CACHE).catch(() => null);
  const cached = cache && await cache.match(request).catch(() => null);
  if (cached) return cached;

  const response = await fetch(request);
  if (cache && response.ok && response.type === "basic") {
    const copy = response.clone();
    // Serialize writes and trims so concurrent chunk downloads preserve the bound.
    pendingWrite = pendingWrite.then(async () => {
      await cache.put(request, copy);
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))
        .map((key) => cache.delete(key)));
    }).catch(() => {});
    // Respond now; the write and trim finish in the background.
    event.waitUntil(pendingWrite);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode === "navigate" || request.destination === "document" ||
    request.headers.has("range") || request.headers.has("rsc") ||
    [...request.headers.keys()].some((name) => name.toLowerCase().startsWith("next-router-"))) return;

  const url = new URL(request.url);
  // TMDB images already have a year-long HTTP cache; opaque Cache Storage entries
  // are padded in quota. Leave all cross-origin requests to the browser.
  if (url.origin !== self.location.origin || url.searchParams.has("_rsc") ||
    /^\/(?:api|watch)(?:\/|$)/.test(url.pathname) || /\.(?:m3u8|ts|mp4|vtt)$/i.test(url.pathname)) return;

  if (url.pathname.startsWith("/_next/static/") || /\.(?:woff2?|ttf|otf|eot)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(event));
  }
  // No catch-all respondWith: HTML, RSC, API, media and other assets pass untouched.
});
