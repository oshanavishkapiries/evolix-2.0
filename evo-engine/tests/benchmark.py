"""Extraction benchmark: time, peak RAM and CPU per job, before/after the optimisations.

    python -m tests.benchmark                       # synthetic: a local page, no external network
    python -m tests.benchmark --live 680 603 550    # real providers for the given TMDB ids (needs internet)

Writes a Markdown report (default docs/evo-engine/benchmarks/benchmark-<mode>.md in the repository root). Concurrency is 1 so figures are per job.
Settings are toggled in-process through the same runtime settings admins use:
BROWSER_POOL_SIZE=0 / BLOCK_ASSETS=0 / EXTRACTION_REUSE_TTL_S=0 is the "before" behaviour.
"""
import argparse
import http.server
import statistics
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from app.core import metrics
from app.core.browser_pool import run_in_browser, shutdown_pool
from app.core.config import APP_NAME, settings
from app.domain.models import StreamSource
from app.interfaces.contracts import IStreamExtractor
from app.services.extraction_cache import CachingExtractor

IMAGE = b"\x89PNG\r\n\x1a\n" + b"0" * 150_000


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/page"):
            imgs = "".join(f'<img src="/img{i}.png?{self.path}">' for i in range(40))
            body = f'<html><body>{imgs}<script>fetch("/api/playlist/x")</script></body></html>'.encode()
            kind = "text/html"
        else:
            body, kind = (IMAGE, "image/png") if ".png" in self.path else (b"#EXTM3U", "text/plain")
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


@contextmanager
def settings_as(**kw):
    old = {k: getattr(settings, k) for k in kw}
    for k, v in kw.items():
        setattr(settings, k, v)
    try:
        yield
    finally:
        for k, v in old.items():
            setattr(settings, k, v)


def pct(values, q):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, -(-int(q * 100) * len(ordered) // 100) - 1))]


def run_jobs(label, job, n):
    rows = []
    for i in range(n):
        with metrics.measure(label) as a:
            job(i)
        rows.append(a)
    return rows


def table_row(label, rows):
    d, r, c = [a.duration_s for a in rows], [a.peak_rss_mb for a in rows], [a.cpu_s for a in rows]
    launches = sum(a.browser_launched for a in rows)
    return f"| {label} | {len(rows)} | {statistics.median(d):.2f} / {pct(d, .95):.2f} | {statistics.median(r):.0f} / {pct(r, .95):.0f} | {statistics.median(c):.2f} / {pct(c, .95):.2f} | {launches} |"


HEADER = "| Scenario | Jobs | Time s (median / p95) | Peak RAM MB (median / p95) | CPU s (median / p95) | Browser launches |\n|---|---|---|---|---|---|"


def synthetic(n):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"

    def browse(i):
        def work(sb):
            sb.page.goto(f"{base}/page?{i}", wait_until="load")
            sb.page.wait_for_timeout(200)
        run_in_browser(work)

    lines = [HEADER]
    scenarios = [
        ("Before: fresh browser per job, nothing blocked", dict(BROWSER_POOL_SIZE=0, BLOCK_ASSETS=0)),
        ("Pooled browser, nothing blocked", dict(BROWSER_POOL_SIZE=1, BLOCK_ASSETS=0)),
        ("Pooled browser + asset blocking", dict(BROWSER_POOL_SIZE=1, BLOCK_ASSETS=1)),
    ]
    for label, cfg in scenarios:
        with settings_as(**cfg):
            browse(-1)  # warm-up (first pooled launch is not representative of steady state)
            lines.append(table_row(label, run_jobs(label, browse, n)))
        shutdown_pool()

    class PageExtractor(IStreamExtractor):
        def extract_streams(self, tmdb_id, media_type="movie", season=None, episode=None):
            browse(tmdb_id)
            return [StreamSource(url="u", quality=q) for q in ("1080p", "720p", "480p")]

    lines2 = [HEADER]
    for label, cfg in [("Before: every quality extracts again", dict(BROWSER_POOL_SIZE=0, BLOCK_ASSETS=0, EXTRACTION_REUSE_TTL_S=0)),
                       ("After: later qualities reuse the extraction (+ pool, blocking)", dict(BROWSER_POOL_SIZE=1, BLOCK_ASSETS=1, EXTRACTION_REUSE_TTL_S=300))]:
        with settings_as(**cfg):
            def three(i):
                c = CachingExtractor(PageExtractor())
                for _ in range(3):  # "Get 720p", "Get 1080p", "Get 480p" for the same title
                    c.extract_streams(100 + i)
            lines2.append(table_row(label + " (3 quality requests per title)", run_jobs("title", three, max(3, n // 2))))
        shutdown_pool()
    server.shutdown()
    return lines, lines2


def live(ids, n):
    from app.api.routes import _composite

    def job(i):
        _composite.extract_streams(ids[i % len(ids)])

    lines = [HEADER]
    for label, cfg in [("Before: fresh browser per job, nothing blocked", dict(BROWSER_POOL_SIZE=0, BLOCK_ASSETS=0, YTHD_DECRYPTOR_CACHE=0)),
                       ("After: pool + blocking + decryptor cache", dict(BROWSER_POOL_SIZE=1, BLOCK_ASSETS=1, YTHD_DECRYPTOR_CACHE=1))]:
        with settings_as(**cfg):
            lines.append(table_row(label, run_jobs(label, job, n)))
        shutdown_pool()
    return lines, []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", nargs="*", type=int, help="TMDB ids to extract from the real providers")
    ap.add_argument("-n", type=int, default=8, help="jobs per scenario")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    mode = "live" if args.live else "synthetic"
    started = time.strftime("%Y-%m-%d %H:%M")
    lines, lines2 = live(args.live, args.n) if args.live else synthetic(args.n)
    report = [
        f"# Extraction benchmark ({mode})", "",
        f"Run {started} on {APP_NAME}; {args.n} jobs per scenario, one at a time. "
        + ("Real providers, TMDB ids " + ", ".join(map(str, args.live)) + "." if args.live else
           "Synthetic: a local page with 40 x 150 kB images plus a playlist request, so the numbers show the cost of browser launch and asset loading, not of any provider."),
        "", "RAM and CPU cover the engine process tree (Python + Playwright driver + Chromium).", "", "## Browser pool and asset blocking", "", *lines,
    ]
    if lines2:
        report += ["", "## Several qualities of one title", "", *lines2]
    out = args.out or Path(__file__).resolve().parents[2] / "docs" / "evo-engine" / "benchmarks" / f"benchmark-{mode}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(report) + "\n")
    print("\n".join(report))
    print(f"\nWritten to {out}")


if __name__ == "__main__":
    main()
