"""Real Chromium: pooled browsers are reused, contexts are isolated, assets are blocked, shutdown is clean."""
import http.server
import threading
import unittest
from unittest import mock

import psutil

from app.core.browser_pool import BrowserPool
from app.core.config import settings
from app.core.filters import extraction_filter

hits = []


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        hits.append(self.path)
        if self.path.startswith("/page"):
            body = b'<html><body><img src="/photo.png"><script>fetch("/api/playlist/x")</script>' \
                   b'<script src="http://ads.doubleclick.net/t.js"></script></body></html>'
            self.send_response(200); self.send_header("Content-Type", "text/html")
        else:
            body = b"x"
            self.send_response(200); self.send_header("Content-Type", "image/png" if self.path.endswith(".png") else "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def chromium_available():
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            p.chromium.launch(args=["--no-sandbox"]).close()
        return True
    except Exception:
        return False


@unittest.skipUnless(chromium_available(), "Chromium is not installed")
class RealBrowserPool(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        hits.clear()
        p = mock.patch.multiple(settings, BROWSER_POOL_SIZE=1, BROWSER_MAX_USES=50, BROWSER_RECYCLE_RSS_MB=0, BLOCK_ASSETS=1)
        p.start()
        self.addCleanup(p.stop)
        self.baseline = {c.pid for c in psutil.Process().children(recursive=True)}
        self.pool = BrowserPool()
        self.addCleanup(self.pool.shutdown)

    def test_reuse_isolation_and_blocking(self):
        def first(sb):
            sb.page.goto(f"{self.base}/page1")
            sb.page.wait_for_timeout(500)
            sb.page.evaluate("document.cookie = 'who=first'; localStorage.setItem('k', 'v')")
            return sb.request_filter._blocked_count

        def second(sb):
            sb.page.goto(f"{self.base}/page2")
            return sb.page.evaluate("[document.cookie, localStorage.getItem('k')]")

        blocked = self.pool.run(first)
        cookie, stored = self.pool.run(second)
        self.assertEqual((cookie, stored), ("", None), "the second extraction must not see the first one's state")
        self.assertGreaterEqual(blocked, 2, "image and tracker were blocked")
        self.assertNotIn("/photo.png", hits, "images are never requested")
        self.assertIn("/api/playlist/x", hits, "the player's own requests still go through")
        self.assertEqual(self.pool.stats()["launched"], 1, "one browser served both extractions")

    def test_blocking_can_be_switched_off(self):
        with mock.patch.object(settings, "BLOCK_ASSETS", 0):
            self.pool.run(lambda sb: (sb.page.goto(f"{self.base}/page3"), sb.page.wait_for_timeout(500)))
        self.assertIn("/photo.png", hits)

    def test_shutdown_leaves_no_browser_processes(self):
        self.pool.run(lambda sb: sb.page.goto(f"{self.base}/page4"))
        self.assertTrue({c.pid for c in psutil.Process().children(recursive=True)} - self.baseline, "a pooled browser is running")
        self.pool.shutdown()
        left = [p for p in psutil.Process().children(recursive=True) if p.pid not in self.baseline and p.is_running() and p.status() != psutil.STATUS_ZOMBIE]
        self.assertEqual(left, [])

    def test_a_killed_browser_is_replaced(self):
        self.pool.run(lambda sb: sb.page.goto(f"{self.base}/page5"))
        slot = self.pool._idle[0]
        for pid in slot.handle._root_pids:
            try:
                victims = [*psutil.Process(pid).children(recursive=True), psutil.Process(pid)]
            except psutil.NoSuchProcess:
                continue
            for p in victims:
                try:
                    p.kill()
                except (psutil.NoSuchProcess, ProcessLookupError):
                    pass  # it went down with its parent
        title = self.pool.run(lambda sb: (sb.page.goto(f"{self.base}/page6"), sb.page.url)[1])
        self.assertTrue(title.endswith("/page6"))
        self.assertEqual(self.pool.stats()["launched"], 2)


if __name__ == "__main__":
    unittest.main()
