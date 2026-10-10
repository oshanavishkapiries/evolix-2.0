// Target of the proxy rewrite for unknown/unpublished titles. A route handler (not a page)
// because pages stream and cannot change their status; this one answers a real 404.
const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Not found | Evolix</title>
<style>
body{margin:0;min-height:100dvh;display:grid;place-content:center;justify-items:center;gap:1rem;text-align:center;padding:2rem;
background:#0a0a0f;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
h1{margin:0;font-size:1.75rem}p{margin:0;color:#b3b3b3}
a{background:#f5a623;color:#000;text-decoration:none;font-weight:600;padding:.65rem 1.4rem;border-radius:.375rem}
a:focus-visible{outline:2px solid #f5a623;outline-offset:2px}
</style></head><body><main>
<h1>Not found</h1><p>This title does not exist or is not available.</p><p><a href="/dashboard">Back to library</a></p>
</main></body></html>`;

export function GET() {
  return new Response(HTML, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
