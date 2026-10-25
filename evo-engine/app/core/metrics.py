"""Measures one extraction attempt: wall time, peak RAM and CPU time of the engine process tree (browsers included).

A sampler thread walks the process tree every SAMPLE_S seconds. Overhead is one cheap `/proc` read per process
per sample (a few ms of CPU per second of extraction), see tests/test_metrics.py for the measured figure.
Concurrent extractions share the tree, so figures are per engine while an attempt runs; set the extraction
concurrency to 1 for exact per-attempt numbers (the benchmark does).
"""
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Callable, Dict, Iterator, Optional

import psutil

SAMPLE_S = 0.2


@dataclass
class Attempt:
    provider: str
    outcome: str = "running"  # ok | failed | invalid (streams did not play)
    duration_s: float = 0.0
    peak_rss_mb: float = 0.0
    cpu_s: float = 0.0
    browser_launched: bool = False
    detail: str = ""
    at: float = field(default_factory=time.time)

    def summary(self) -> str:
        return (
            f"{self.provider}: {self.outcome} · {self.duration_s:.1f}s · peak {self.peak_rss_mb:.0f} MB · "
            f"cpu {self.cpu_s:.1f}s · {'new browser' if self.browser_launched else 'no new browser'}"
        )


# One list per enclosing measurement, innermost last: a launch counts for every attempt it happened inside.
_launched: ContextVar[Optional[list]] = ContextVar("evo_browser_launch", default=None)


def mark_browser_launch() -> None:
    """Called (from the thread running the attempt) whenever the attempt had to start a browser process."""
    for flag in _launched.get() or []:
        flag.append(True)


def _tree(root: psutil.Process):
    try:
        return [root, *root.children(recursive=True)]
    except psutil.Error:
        return [root]


class _Sampler(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="evo-metrics")
        self.stop_event = threading.Event()
        self.root = psutil.Process()
        self.cpu_start: Dict[int, float] = {}
        self.cpu_seen: Dict[int, float] = {}
        self.peak_rss = 0
        self._take(first=True)

    def _take(self, first: bool = False):
        rss = 0
        for p in _tree(self.root):
            try:
                with p.oneshot():
                    rss += p.memory_info().rss
                    t = p.cpu_times()
                    cpu = t.user + t.system
            except psutil.Error:
                continue
            if first:
                self.cpu_start[p.pid] = cpu
            self.cpu_start.setdefault(p.pid, 0.0)  # started during the attempt: all of its CPU counts
            self.cpu_seen[p.pid] = max(self.cpu_seen.get(p.pid, 0.0), cpu)
        self.peak_rss = max(self.peak_rss, rss)

    def run(self):
        while not self.stop_event.wait(SAMPLE_S):
            self._take()

    def finish(self):
        self.stop_event.set()
        self.join(timeout=2)
        self._take()
        return self.peak_rss / 1024 / 1024, sum(max(0.0, c - self.cpu_start.get(pid, 0.0)) for pid, c in self.cpu_seen.items())


Sink = Callable[[Attempt], None]
_sink: Optional[Sink] = None


def set_sink(sink: Optional[Sink]) -> None:
    """Where finished attempts go (the SQLite repository)."""
    global _sink
    _sink = sink


@contextmanager
def measure(provider: str) -> Iterator[Attempt]:
    """`with measure("CineSrc") as a:` ... set `a.outcome` before leaving; an exception marks it failed."""
    attempt = Attempt(provider)
    flag: list = []
    token = _launched.set([*(_launched.get() or []), flag])
    sampler = _Sampler()
    sampler.start()
    t0 = time.monotonic()
    try:
        yield attempt
        if attempt.outcome == "running":
            attempt.outcome = "ok"
    except BaseException as e:
        attempt.outcome = "failed"
        attempt.detail = str(e)[:300]
        raise
    finally:
        attempt.duration_s = time.monotonic() - t0
        attempt.peak_rss_mb, attempt.cpu_s = sampler.finish()
        attempt.browser_launched = bool(flag)
        _launched.reset(token)
        if _sink:
            try:
                _sink(attempt)
            except Exception:  # measuring must never break extraction
                pass
