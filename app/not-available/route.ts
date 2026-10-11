// Target of the proxy rewrite for unknown/unpublished titles. A route handler (not a page)
// because pages stream and cannot change their status; this one answers a real 404.
const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#161616"><title>Not found | Evolix</title>
<style>
body{margin:0;min-height:100dvh;display:grid;place-items:center;text-align:center;padding:2rem 1.25rem;line-height:1.5;color:#fff;
background:radial-gradient(80% 60% at 50% 0%,rgba(245,166,35,.14),transparent 65%),linear-gradient(180deg,#1d1d1d,#161616 70%);
font-family:"Noto Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{display:grid;justify-items:center;gap:.9rem;width:min(100%,30rem)}
.b{font-size:1.6rem;font-weight:800;letter-spacing:-.02em;color:#f5a623;text-decoration:none;margin-bottom:1rem}
.c{margin:0;font-size:clamp(5rem,22vw,8rem);font-weight:800;line-height:1;letter-spacing:-.04em;background:linear-gradient(180deg,#ffb83d,#c9831a);-webkit-background-clip:text;background-clip:text;color:transparent}
h1{margin:0;font-size:clamp(1.4rem,4vw,1.9rem)}p{margin:0;color:#a8a8a8}
.a{display:inline-flex;align-items:center;justify-content:center;min-height:2.9rem;padding:0 1.5rem;margin-top:.75rem;background:#f5a623;color:#1a1a1a;text-decoration:none;font-weight:600;border-radius:6px}
.a:hover{background:#ffb83d}.a:focus-visible,.b:focus-visible{outline:2px solid #f5a623;outline-offset:2px}
</style></head><body><main>
<a class="b" href="/dashboard">evolix</a><p class="c" aria-hidden="true">404</p>
<h1>Not found</h1><p>This title does not exist or is not available.</p><a class="a" href="/dashboard">Back to library</a>
</main></body></html>`;

export function GET() {
  return new Response(HTML, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
