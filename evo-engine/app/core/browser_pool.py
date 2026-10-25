"""A small pool of long-lived headless browsers; every extraction gets its own isolated context.

Playwright's sync API is bound to the thread that started it, so each pooled browser lives on its own worker
thread and extraction code is shipped to that thread (`BrowserPool.run`). Browsers are replaced when they crash,
after BROWSER_MAX_USES extractions, or when their process tree grows past BROWSER_RECYCLE_RSS_MB. With
BROWSER_POOL_SIZE = 0 every extraction launches its own browser, as before.
"""
import logging
import queue
import threading
from collections import deque
from concurrent.futures import Future
from typing import Any, Callable, Optional

import psutil

from app.core.config import settings
from app.core.filters import extraction_filter
from app.core.metrics import mark_browser_launch
from app.core.stealth import CHROME_ARGS, StealthBrowser

logger = logging.getLogger("evo.browser_pool")


class BrowserCrashed(RuntimeError):
    pass


class PlaywrightBrowser:
    """One real Chromium on its own thread. Anything with the same four members works in tests."""

    _launch_lock = threading.Lock()  # launches are serialised so a new browser's processes can be told apart

    def __init__(self):
        self._jobs: "queue.Queue[Optional[tuple[Callable, Future]]]" = queue.Queue()
        self._ready = threading.Event()
        self._error: Optional[BaseException] = None
        self._browser = None
        self._root_pids: list[int] = []
        self._thread = threading.Thread(target=self._loop, daemon=True, name="evo-browser")
        self._thread.start()
        self._ready.wait()
        if self._error:
            raise self._error

    def _loop(self):
        from playwright.sync_api import sync_playwright

        pw = None
        try:
            with self._launch_lock:
                me = psutil.Process()
                before = {c.pid for c in me.children()}
                pw = sync_playwright().start()
                self._browser = pw.chromium.launch(headless=True, args=CHROME_ARGS)
                self._root_pids = [c.pid for c in me.children() if c.pid not in before]
        except BaseException as e:
            self._error = e
        finally:
            self._ready.set()
        if self._error:
            if pw:
                pw.stop()
            return
        while True:
            item = self._jobs.get()
            if item is None:
                break
            fn, fut = item
            try:
                fut.set_result(fn(self._browser))
            except BaseException as e:
                fut.set_exception(e)
        for close in (self._browser.close, pw.stop):
            try:
                close()
            except Exception as e:  # a crashed browser or driver is already gone
                logger.debug(f"Closing a pooled browser: {e}")

    def submit(self, fn: Callable[[Any], Any]) -> Future:
        fut: Future = Future()
        self._jobs.put((fn, fut))
        return fut

    def alive(self) -> bool:
        try:
            if not (self._thread.is_alive() and self._browser is not None and self._browser.is_connected()):
                return False
            # The driver process can die without the browser object noticing.
            return all(psutil.pid_exists(pid) and psutil.Process(pid).status() != psutil.STATUS_ZOMBIE for pid in self._root_pids)
        except Exception:
            return False

    def rss_mb(self) -> float:
        total = 0
        for pid in self._root_pids:
            try:
                root = psutil.Process(pid)
                for p in [root, *root.children(recursive=True)]:
                    try:
                        total += p.memory_info().rss
                    except psutil.Error:
                        pass
            except psutil.Error:
                pass
        return total / 1024 / 1024

    def stop(self):
        self._jobs.put(None)
        self._thread.join(timeout=15)


class _Slot:
    def __init__(self, handle):
        self.handle = handle
        self.uses = 0


class BrowserPool:
    def __init__(self, factory: Callable[[], Any] = PlaywrightBrowser):
        self._factory = factory
        self._cv = threading.Condition()
        self._idle: deque = deque()
        self._count = 0
        self._closed = False
        self.launched = 0
        self.recycled = 0

    # ---- slots
    def _acquire(self) -> "tuple[_Slot, bool]":
        with self._cv:
            while True:
                if self._closed:
                    raise RuntimeError("browser pool is shut down")
                if self._idle:
                    return self._idle.popleft(), False
                if self._count < max(1, settings.BROWSER_POOL_SIZE):
                    self._count += 1
                    break
                self._cv.wait()
        try:
            slot = _Slot(self._factory())
        except BaseException:
            with self._cv:
                self._count -= 1
                self._cv.notify()
            raise
        self.launched += 1
        return slot, True

    def _release(self, slot: _Slot, healthy: bool):
        limit = settings.BROWSER_RECYCLE_RSS_MB
        reason = None
        if not healthy:
            reason = "crashed"
        elif slot.uses >= settings.BROWSER_MAX_USES:
            reason = f"used {slot.uses} times"
        elif limit and slot.handle.rss_mb() > limit:
            reason = "memory over the limit"
        elif self._count > max(1, settings.BROWSER_POOL_SIZE):
            reason = "pool shrunk"
        with self._cv:
            if reason is None and not self._closed:
                self._idle.append(slot)
                self._cv.notify()
                return
            self._count -= 1
            self._cv.notify()
        if reason:
            self.recycled += 1
            logger.info(f"Replacing a pooled browser ({reason})")
        try:
            slot.handle.stop()
        except Exception as e:
            logger.warning(f"Closing a pooled browser failed: {e}")

    # ---- use
    def run(self, work: Callable[[StealthBrowser], Any], request_filter=None, attempts: int = 2):
        """Runs `work(stealth_browser)` on a pooled browser, in a fresh context that is closed afterwards.

        A browser that dies mid-job is replaced and the job retried once on another one; other errors are the job's own.
        """
        def job(browser):
            sb = StealthBrowser(browser=browser, request_filter=request_filter or extraction_filter())
            sb.start()
            try:
                return work(sb)
            finally:
                try:
                    sb.close()
                except Exception:
                    pass

        last: Optional[BaseException] = None
        for _ in range(attempts):
            slot, fresh = self._acquire()
            if fresh:
                mark_browser_launch()
            slot.uses += 1
            try:
                result = slot.handle.submit(job).result()
            except BaseException as e:
                alive = slot.handle.alive()
                self._release(slot, healthy=alive)
                if alive:
                    raise
                last = e
                logger.warning(f"A pooled browser died during an extraction: {e}")
                continue
            self._release(slot, healthy=True)
            return result
        raise BrowserCrashed(f"The browser crashed on every attempt: {last}")

    def stats(self) -> dict:
        with self._cv:
            return {"size": self._count, "idle": len(self._idle), "launched": self.launched, "recycled": self.recycled}

    def shutdown(self):
        with self._cv:
            self._closed = True
            idle = list(self._idle)
            self._idle.clear()
            self._cv.notify_all()
        for slot in idle:
            try:
                slot.handle.stop()
            except Exception:
                pass


_pool: Optional[BrowserPool] = None
_pool_lock = threading.Lock()


def get_pool() -> BrowserPool:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = BrowserPool()
        return _pool


def shutdown_pool() -> None:
    global _pool
    with _pool_lock:
        pool, _pool = _pool, None
    if pool:
        pool.shutdown()


def run_in_browser(work: Callable[[StealthBrowser], Any], request_filter=None, **stealth_kwargs):
    """Entry point for extractors: pooled when BROWSER_POOL_SIZE > 0, otherwise a one-off browser in this thread."""
    if settings.BROWSER_POOL_SIZE > 0:
        return get_pool().run(work, request_filter=request_filter)
    with StealthBrowser(headless=True, request_filter=request_filter or extraction_filter(), **stealth_kwargs) as sb:
        return work(sb)
