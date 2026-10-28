import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from app.core import metrics, notes
from app.core.browser_pool import BrowserCrashed, BrowserPool
from app.core.config import settings
from app.domain.models import StreamSource
from app.interfaces.contracts import IStreamExtractor, TitleNotFound
from app.services.composite_extractor import CompositeStreamExtractor
from app.services.decryptor_cache import DecryptorCache, version_from_page
from app.services.extraction_cache import CachingExtractor
from app.services.provider_health import ProviderHealth
from app.services.sqlite_repository import SQLiteTaskRepository

STREAMS = [StreamSource(url="https://cdn/1080.m3u8", quality="1080p"), StreamSource(url="https://cdn/720.m3u8", quality="720p")]


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def patch(**kw):
    return mock.patch.multiple(settings, **kw)


class Provider(IStreamExtractor):
    """Scripted provider: each call pops the next outcome (an exception to raise or a stream list)."""

    def __init__(self, *outcomes, delay=0.0):
        self.outcomes = list(outcomes)
        self.calls = 0
        self.delay = delay

    def extract_streams(self, tmdb_id, media_type="movie", season=None, episode=None):
        self.calls += 1
        time.sleep(self.delay)
        out = self.outcomes.pop(0) if len(self.outcomes) > 1 else self.outcomes[0]
        if isinstance(out, Exception):
            raise out
        return out


class Alpha(Provider):
    pass


class Beta(Provider):
    pass


class MetricsTests(unittest.TestCase):
    def test_attempt_records_time_ram_cpu_and_outcome(self):
        seen = []
        metrics.set_sink(seen.append)
        self.addCleanup(metrics.set_sink, None)
        with metrics.measure("Alpha") as a:
            sum(i * i for i in range(2_000_000))
            time.sleep(0.3)
        self.assertEqual(a.outcome, "ok")
        self.assertGreaterEqual(a.duration_s, 0.3)
        self.assertGreater(a.peak_rss_mb, 10)
        self.assertGreater(a.cpu_s, 0.05)
        self.assertFalse(a.browser_launched)
        self.assertEqual(seen, [a])

    def test_launch_counts_for_enclosing_attempts_too(self):
        with metrics.measure("outer") as outer:
            with metrics.measure("inner") as inner:
                metrics.mark_browser_launch()
        self.assertTrue(inner.browser_launched and outer.browser_launched)

    def test_failure_is_recorded_and_reraised(self):
        seen = []
        metrics.set_sink(seen.append)
        self.addCleanup(metrics.set_sink, None)
        with self.assertRaises(ValueError):
            with metrics.measure("Alpha"):
                raise ValueError("boom")
        self.assertEqual((seen[0].outcome, seen[0].detail), ("failed", "boom"))

    def test_browser_launch_is_flagged(self):
        with metrics.measure("Alpha") as a:
            metrics.mark_browser_launch()
        self.assertTrue(a.browser_launched)

    def test_sampler_overhead_is_negligible(self):
        """Wall-clock cost of the sampler around a CPU-bound loop (documented in the ticket)."""
        def work():
            return sum(i * i for i in range(3_000_000))

        t = time.perf_counter(); work(); plain = time.perf_counter() - t
        t = time.perf_counter()
        with metrics.measure("Alpha"):
            work()
        measured = time.perf_counter() - t
        print(f"\n  metrics overhead: plain {plain:.3f}s, measured {measured:.3f}s")
        self.assertLess(measured - plain, 0.25)

    def test_summary_has_median_and_p95_per_provider(self):
        with tempfile.TemporaryDirectory() as d:
            repo = SQLiteTaskRepository(Path(d) / "t.sqlite3")
            for dur in (1, 2, 3, 4, 100):
                repo.add_metric(metrics.Attempt("Alpha", "ok", duration_s=dur, peak_rss_mb=dur * 10, cpu_s=dur))
            repo.add_metric(metrics.Attempt("Alpha", "failed", duration_s=2, peak_rss_mb=20, cpu_s=2, browser_launched=True))
            s = repo.metric_summary(24)["providers"]["Alpha"]
            self.assertEqual((s["attempts"], s["ok"], s["failed"], s["browser_launches"]), (6, 5, 1, 1))
            self.assertEqual(s["duration_s"], {"median": 2.0, "p95": 100.0})


class ProviderHealthTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.health = ProviderHealth(self.clock)
        p = patch(PROVIDER_FAIL_THRESHOLD=3, PROVIDER_FAIL_WINDOW_S=100, PROVIDER_COOLDOWN_S=60)
        p.start()
        self.addCleanup(p.stop)

    def fail(self, n=1, name="Alpha"):
        for _ in range(n):
            self.assertEqual(self.health.before(name), "go")
            self.health.failure(name)

    def test_threshold_then_skip(self):
        self.fail(2)
        self.assertEqual(self.health.before("Alpha"), "go")
        self.health.failure("Alpha")
        self.assertEqual(self.health.before("Alpha"), "skip")
        self.assertEqual(self.health.snapshot(["Alpha"])[0]["state"], "cooling")

    def test_success_resets_the_streak_and_old_failures_expire(self):
        self.fail(2)
        self.health.success("Alpha")
        self.fail(2)
        self.assertEqual(self.health.before("Alpha"), "go")
        self.clock.t += 101  # window passed: the two failures no longer count
        self.fail(1)
        self.assertEqual(self.health.before("Alpha"), "go")

    def test_one_trial_after_cooldown_then_restore(self):
        self.fail(3)
        self.clock.t += 61
        self.assertEqual(self.health.before("Alpha"), "trial")
        self.assertEqual(self.health.before("Alpha"), "skip")  # only one trial at a time
        self.health.success("Alpha")
        self.assertEqual(self.health.before("Alpha"), "go")
        self.assertEqual(self.health.snapshot(["Alpha"])[0]["state"], "healthy")

    def test_failed_trial_starts_another_cooldown(self):
        self.fail(3)
        self.clock.t += 61
        self.assertEqual(self.health.before("Alpha"), "trial")
        self.health.failure("Alpha")
        self.assertEqual(self.health.before("Alpha"), "skip")
        self.clock.t += 61
        self.assertEqual(self.health.before("Alpha"), "trial")

    def test_manual_reset_and_disabled_threshold(self):
        self.fail(3)
        self.health.reset("Alpha")
        self.assertEqual(self.health.before("Alpha"), "go")
        with patch(PROVIDER_FAIL_THRESHOLD=0):
            self.fail(10)
            self.assertEqual(self.health.before("Alpha"), "go")


class CompositeTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        p = patch(PROVIDER_FAIL_THRESHOLD=2, PROVIDER_FAIL_WINDOW_S=100, PROVIDER_COOLDOWN_S=60)
        p.start()
        self.addCleanup(p.stop)

    def composite(self, *providers, **kw):
        return CompositeStreamExtractor(list(providers), health=ProviderHealth(self.clock), **kw)

    def test_failing_provider_is_skipped_and_jobs_go_to_the_next(self):
        a, b = Alpha(RuntimeError("down")), Beta(STREAMS)
        c = self.composite(a, b)
        for _ in range(4):
            self.assertEqual(c.extract_streams(1), STREAMS)
        self.assertEqual(a.calls, 2)  # skipped from the third job on
        self.assertEqual(b.calls, 4)

    def test_admin_order_decides_who_goes_first_and_applies_to_the_next_job(self):
        a, b = Alpha(STREAMS), Beta(STREAMS)
        order = ["Alpha", "Beta"]
        c = self.composite(a, b, order=lambda xs: sorted(xs, key=lambda e: order.index(e.__class__.__name__)))
        c.extract_streams(1)
        self.assertEqual((a.calls, b.calls), (1, 0))
        order.reverse()  # the admin flips the setting; no restart
        c.extract_streams(1)
        self.assertEqual((a.calls, b.calls), (1, 1))
        self.assertEqual(c.provider_names, ["Beta", "Alpha"])

    def test_events_show_skip_and_metrics(self):
        a, b = Alpha(RuntimeError("down")), Beta(STREAMS)
        c = self.composite(a, b)
        c.extract_streams(1)
        c.extract_streams(1)
        with notes.collect() as n:
            c.extract_streams(1)
        text = "\n".join(n)
        self.assertIn("Alpha skipped: cooling down until", text)
        self.assertIn("Beta: ok", text)
        self.assertIn("peak", text)

    def test_all_cooling_fails_fast_with_reason(self):
        a = Alpha(RuntimeError("down"))
        c = self.composite(a)
        for _ in range(2):
            with self.assertRaises(RuntimeError):
                c.extract_streams(1)
        t = time.monotonic()
        with self.assertRaises(RuntimeError) as cm:
            c.extract_streams(1)
        self.assertLess(time.monotonic() - t, 0.5)
        self.assertIn("No provider is available", str(cm.exception))
        self.assertIn("cooling down", str(cm.exception))
        self.assertEqual(a.calls, 2)

    def test_trial_after_cooldown_restores_provider(self):
        a = Alpha(RuntimeError("down"), RuntimeError("down"), STREAMS)
        c = self.composite(a)
        for _ in range(2):
            with self.assertRaises(RuntimeError):
                c.extract_streams(1)
        self.clock.t += 61
        self.assertEqual(c.extract_streams(1), STREAMS)
        self.assertEqual(c.health.snapshot(["Alpha"])[0]["state"], "healthy")

    def test_invalid_streams_count_as_failures(self):
        def reject(_):
            raise RuntimeError("expired")

        c = self.composite(Alpha(STREAMS), validator=reject)
        for _ in range(2):
            self.assertEqual(c.extract_streams(1), STREAMS)  # unvalidated fallback still serves the job
        self.assertEqual(c.health.snapshot(["Alpha"])[0]["state"], "cooling")


class CachingTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        p = patch(EXTRACTION_REUSE_TTL_S=300)
        p.start()
        self.addCleanup(p.stop)

    def test_second_quality_reuses_the_extraction(self):
        inner = Provider(STREAMS)
        c = CachingExtractor(inner, clock=self.clock)
        with notes.collect() as n1:
            c.extract_streams(7)
        with notes.collect() as n2:
            c.extract_streams(7)
        self.assertEqual(inner.calls, 1)
        self.assertIn("Fresh extraction", n1)
        self.assertTrue(any(x.startswith("Reused extraction") for x in n2))
        c.extract_streams(7, "tv", 1, 2)  # another episode is its own extraction
        self.assertEqual(inner.calls, 2)

    def test_invalid_stored_urls_trigger_exactly_one_reextraction(self):
        fresh = [StreamSource(url="https://cdn/new.m3u8", quality="720p")]
        inner = Provider(STREAMS, fresh)
        bad = {"on": False}

        def validator(streams):
            if bad["on"] and streams is not fresh:
                raise RuntimeError("token expired")

        c = CachingExtractor(inner, validator=validator, clock=self.clock)
        c.extract_streams(7)
        bad["on"] = True
        with notes.collect() as n:
            self.assertEqual(c.extract_streams(7), fresh)
        self.assertEqual(inner.calls, 2)
        self.assertTrue(any("no longer valid" in x for x in n))
        c.extract_streams(7)  # the refreshed set is stored and reused
        self.assertEqual(inner.calls, 2)

    def test_concurrent_requests_share_one_extraction(self):
        inner = Provider(STREAMS, delay=0.4)
        c = CachingExtractor(inner, clock=self.clock)
        with ThreadPoolExecutor(6) as pool:
            results = list(pool.map(lambda _: c.extract_streams(9), range(6)))
        self.assertEqual(inner.calls, 1)
        self.assertTrue(all(r == STREAMS for r in results))

    def test_results_expire_and_reuse_can_be_disabled(self):
        inner = Provider(STREAMS)
        c = CachingExtractor(inner, clock=self.clock)
        c.extract_streams(3)
        self.clock.t += 301
        c.extract_streams(3)
        self.assertEqual(inner.calls, 2)
        with patch(EXTRACTION_REUSE_TTL_S=0):
            c.extract_streams(3)
            c.extract_streams(3)
        self.assertEqual(inner.calls, 4)

    def test_failed_extraction_is_not_stored(self):
        inner = Provider(RuntimeError("all down"), STREAMS)
        c = CachingExtractor(inner, clock=self.clock)
        with self.assertRaises(RuntimeError):
            c.extract_streams(5)
        self.assertEqual(c.extract_streams(5), STREAMS)


class DecryptorCacheTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.downloads = []

    def fetch(self, url):
        self.downloads.append(url)
        return f"// script from {url}"

    def url_for(self, v):
        return f"https://p/vsdec.js?v={v}"

    def cache(self):
        return DecryptorCache(Path(self.dir.name))

    def test_unchanged_version_downloads_once_and_survives_restart(self):
        with patch(YTHD_DECRYPTOR_CACHE=1):
            with notes.collect() as n:
                self.cache().get(self.url_for, "1", self.fetch)
                self.cache().get(self.url_for, "1", self.fetch)  # a new instance = an engine restart
        self.assertEqual(len(self.downloads), 1)
        self.assertEqual([x.split(": ")[1] for x in n], ["fetched and cached", "cache hit"])

    def test_new_version_is_fetched_and_old_ones_pruned(self):
        with patch(YTHD_DECRYPTOR_CACHE=1):
            c = DecryptorCache(Path(self.dir.name), keep=2)
            for v in ("1", "2", "3"):
                time.sleep(0.02)
                c.get(self.url_for, v, self.fetch)
        self.assertEqual(len(self.downloads), 3)
        self.assertEqual(sorted(p.name for p in Path(self.dir.name).glob("*.js")), ["vsdec-2.js", "vsdec-3.js"])

    def test_refresh_replaces_the_cached_copy(self):
        with patch(YTHD_DECRYPTOR_CACHE=1):
            c = self.cache()
            c.get(self.url_for, "1", lambda u: "old")
            with notes.collect() as n:
                self.assertEqual(c.refresh(self.url_for, "1", lambda u: "new"), "new")
            self.assertEqual(c.get(self.url_for, "1", self.fetch)[0], "new")
        self.assertIn("refreshed", n[0])

    def test_cache_off_always_downloads(self):
        with patch(YTHD_DECRYPTOR_CACHE=0):
            c = self.cache()
            c.get(self.url_for, "1", self.fetch)
            c.get(self.url_for, "1", self.fetch)
        self.assertEqual(len(self.downloads), 2)

    def test_version_comes_from_the_player_page(self):
        self.assertEqual(version_from_page('<script src="/assets/vsdec.js?v=42"></script>'), "42")
        self.assertEqual(version_from_page("nothing here"), "1786492668")


class FakeBrowser:
    created = 0

    def __init__(self):
        FakeBrowser.created += 1
        self.id = FakeBrowser.created
        self._alive = True
        self.rss = 100.0
        self.stopped = False
        self._ex = ThreadPoolExecutor(1)

    def submit(self, fn):
        return self._ex.submit(fn, self)

    def alive(self):
        return self._alive

    def rss_mb(self):
        return self.rss

    def stop(self):
        self.stopped = True
        self._ex.shutdown()


class FakeStealth:
    contexts = 0
    closed = 0

    def __init__(self, browser=None, request_filter=None, **_):
        self.browser = browser

    def start(self):
        FakeStealth.contexts += 1
        self.page = object()

    def close(self):
        FakeStealth.closed += 1


class PoolTests(unittest.TestCase):
    def setUp(self):
        FakeBrowser.created = FakeStealth.contexts = FakeStealth.closed = 0
        for p in (patch(BROWSER_POOL_SIZE=2, BROWSER_MAX_USES=3, BROWSER_RECYCLE_RSS_MB=500), mock.patch("app.core.browser_pool.StealthBrowser", FakeStealth), mock.patch("app.core.browser_pool.extraction_filter", lambda: None)):
            p.start()
            self.addCleanup(p.stop)
        self.pool = BrowserPool(FakeBrowser)
        self.addCleanup(self.pool.shutdown)

    def test_browsers_are_reused_with_a_fresh_context_each_time(self):
        ids = [self.pool.run(lambda sb: sb.browser.id) for _ in range(3)]
        self.assertEqual(ids, [1, 1, 1])
        self.assertEqual((FakeStealth.contexts, FakeStealth.closed), (3, 3))

    def test_recycled_after_max_uses(self):
        ids = [self.pool.run(lambda sb: sb.browser.id) for _ in range(4)]
        self.assertEqual(ids, [1, 1, 1, 2])
        self.assertEqual(self.pool.stats()["recycled"], 1)

    def test_recycled_when_memory_grows(self):
        def grow(sb):
            sb.browser.rss = 900.0
            return sb.browser.id

        self.assertEqual(self.pool.run(grow), 1)
        self.assertEqual(self.pool.run(lambda sb: sb.browser.id), 2)

    def test_crashed_browser_is_replaced_and_job_retried(self):
        state = {"n": 0}

        def work(sb):
            state["n"] += 1
            if state["n"] == 1:
                sb.browser._alive = False
                raise RuntimeError("Target closed")
            return sb.browser.id

        self.assertEqual(self.pool.run(work), 2)

    def test_job_errors_with_a_healthy_browser_are_not_retried(self):
        calls = []

        def work(sb):
            calls.append(1)
            raise ValueError("page broke")

        with self.assertRaises(ValueError):
            self.pool.run(work)
        self.assertEqual(len(calls), 1)

    def test_always_crashing_raises(self):
        def work(sb):
            sb.browser._alive = False
            raise RuntimeError("Target closed")

        with self.assertRaises(BrowserCrashed):
            self.pool.run(work)

    def test_concurrency_is_bounded_by_pool_size(self):
        running, peak, lock = [0], [0], threading.Lock()

        def work(sb):
            with lock:
                running[0] += 1
                peak[0] = max(peak[0], running[0])
            time.sleep(0.1)
            with lock:
                running[0] -= 1

        with ThreadPoolExecutor(6) as ex:
            list(ex.map(lambda _: self.pool.run(work), range(6)))
        self.assertEqual(peak[0], 2)

    def test_shutdown_closes_idle_browsers(self):
        self.pool.run(lambda sb: None)
        browser = self.pool._idle[0].handle
        self.pool.shutdown()
        self.assertTrue(browser.stopped)


class ExtractorOrderSetting(unittest.TestCase):
    def test_only_known_orders_are_accepted(self):
        from app.core import runtime_config
        self.assertEqual(runtime_config.coerce("EXTRACTOR_ORDER", "ythd,cinesrc"), "ythd,cinesrc")
        for bad in ("ythd", "", "cinesrc,ythd,x", 1, None):
            with self.assertRaises(ValueError):
                runtime_config.coerce("EXTRACTOR_ORDER", bad)

    def test_routes_rank_the_real_providers_by_the_setting(self):
        from app.api import routes
        name = lambda xs: [x.__class__.__name__ for x in xs]
        both = [routes._cinesrc_extractor, routes._ythd_extractor]
        with patch(EXTRACTOR_ORDER="ythd,cinesrc"):
            self.assertEqual(name(routes._by_admin_order(both)), ["YtHdStreamExtractor", "CineSrcStreamExtractor"])
        with patch(EXTRACTOR_ORDER="cinesrc,ythd"):
            self.assertEqual(name(routes._by_admin_order(both)), ["CineSrcStreamExtractor", "YtHdStreamExtractor"])
        with patch(EXTRACTOR_ORDER="garbage"):  # a bad stored value must not take the pipeline down
            self.assertEqual(len(routes._by_admin_order(both)), 2)


class TitleNotFoundTests(unittest.TestCase):
    """A title no provider has must not put the providers on cool-down for everyone else."""

    def setUp(self):
        self.clock = Clock()
        p = patch(PROVIDER_FAIL_THRESHOLD=2, PROVIDER_FAIL_WINDOW_S=100, PROVIDER_COOLDOWN_S=60, PROVIDER_MISS_THRESHOLD=4)
        p.start()
        self.addCleanup(p.stop)

    def composite(self, *providers):
        return CompositeStreamExtractor(list(providers), health=ProviderHealth(self.clock))

    def test_a_missing_title_does_not_block_the_next_viewer(self):
        a, b = Alpha(TitleNotFound("no copy")), Beta(TitleNotFound("no copy"))
        c = self.composite(a, b)
        for _ in range(3):  # more than PROVIDER_FAIL_THRESHOLD, fewer than PROVIDER_MISS_THRESHOLD
            with self.assertRaisesRegex(RuntimeError, "All stream extractors failed"):
                c.extract_streams(1)
        a.outcomes, b.outcomes = [STREAMS], [STREAMS]
        self.assertEqual(c.extract_streams(2), STREAMS)  # someone else's title still works

    def test_real_failures_still_cool_down(self):
        a = Alpha(RuntimeError("timeout"))
        c = self.composite(a)
        for _ in range(2):
            with self.assertRaises(RuntimeError):
                c.extract_streams(1)
        with self.assertRaisesRegex(RuntimeError, "No provider is available"):
            c.extract_streams(2)

    def test_a_provider_that_finds_nothing_for_too_long_is_cooled_down(self):
        a = Alpha(TitleNotFound("no copy"))
        c = self.composite(a)
        for _ in range(4):
            with self.assertRaises(RuntimeError):
                c.extract_streams(1)
        with self.assertRaisesRegex(RuntimeError, "No provider is available"):
            c.extract_streams(2)

    def test_one_success_clears_the_run_of_misses(self):
        a = Alpha(TitleNotFound("no copy"))
        c = self.composite(a)
        for _ in range(3):
            with self.assertRaises(RuntimeError):
                c.extract_streams(1)
        a.outcomes = [STREAMS]
        c.extract_streams(2)
        a.outcomes = [TitleNotFound("no copy")]
        for _ in range(3):  # would be the 6th miss without the reset
            with self.assertRaisesRegex(RuntimeError, "All stream extractors failed"):
                c.extract_streams(3)

    def test_a_miss_is_still_reported_as_a_failed_attempt(self):
        c = self.composite(Alpha(TitleNotFound("no copy")))
        with notes.collect() as n:
            with self.assertRaises(RuntimeError):
                c.extract_streams(1)
        self.assertIn("Alpha", "\n".join(n))


class ProviderNotFoundSignals(unittest.TestCase):
    """Which provider answers mean "no such title" and which mean "the provider is broken"."""

    def response(self, status, body=None):
        r = mock.Mock(status_code=status, text="")
        r.json.return_value = body if body is not None else {}
        return r

    def ythd(self, *responses):
        from app.services.ythd_extractor import YtHdStreamExtractor
        session = mock.Mock()
        session.get.side_effect = list(responses)
        patcher = mock.patch("app.services.ythd_extractor.requests.Session", return_value=session)
        patcher.start()
        self.addCleanup(patcher.stop)
        return YtHdStreamExtractor(decryptors=mock.Mock())

    def test_ythd_without_a_source_is_not_found(self):
        for r in (self.response(404), self.response(200, {"error": "none"})):
            with self.assertRaises(TitleNotFound):
                self.ythd(r).extract_streams(1)

    def test_ythd_server_error_is_a_real_failure(self):
        with self.assertRaises(RuntimeError) as cm:
            self.ythd(self.response(503)).extract_streams(1)
        self.assertNotIsInstance(cm.exception, TitleNotFound)

    def cinesrc(self, navigation_fails):
        from app.services.cinesrc_extractor import CineSrcStreamExtractor
        page = mock.Mock()
        if navigation_fails:
            page.goto.side_effect = RuntimeError("net::ERR_CONNECTION_REFUSED")
        sb = mock.Mock(page=page)
        return CineSrcStreamExtractor(timeout_seconds=0), mock.patch("app.services.cinesrc_extractor.run_in_browser", side_effect=lambda work: work(sb))

    def test_cinesrc_page_opened_but_no_playlist_is_not_found(self):
        extractor, run = self.cinesrc(navigation_fails=False)
        with run, self.assertRaises(TitleNotFound):
            extractor.extract_streams(1)

    def test_cinesrc_page_that_never_opened_is_a_real_failure(self):
        extractor, run = self.cinesrc(navigation_fails=True)
        with run, self.assertRaises(RuntimeError) as cm:
            extractor.extract_streams(1)
        self.assertNotIsInstance(cm.exception, TitleNotFound)


if __name__ == "__main__":
    unittest.main()
