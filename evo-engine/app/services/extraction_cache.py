import logging
import threading
import time
from concurrent.futures import Future
from typing import Callable, Dict, List, Optional, Tuple

from app.core.config import settings
from app.core.notes import note
from app.domain.models import StreamSource
from app.interfaces.contracts import IStreamExtractor

logger = logging.getLogger("evo.extraction_cache")

MAX_ENTRIES = 200
Key = Tuple[int, str, Optional[int], Optional[int]]


class CachingExtractor(IStreamExtractor):
    """Shares one extraction between every quality request for the same title or episode.

    An extraction already holds the URLs of all qualities, so a later request (another quality) reuses them for
    EXTRACTION_REUSE_TTL_S instead of launching the providers again. Reused URLs are first checked with the
    validator; if they no longer play (expired token) they are dropped and the title is extracted once more.
    Requests that arrive while an extraction is running wait for it instead of starting their own.
    """

    def __init__(self, inner: IStreamExtractor, validator: Optional[Callable[[List[StreamSource]], None]] = None, clock: Callable[[], float] = time.monotonic):
        self.inner = inner
        self.validator = validator
        self._clock = clock
        self._lock = threading.Lock()
        self._entries: Dict[Key, Tuple[float, List[StreamSource]]] = {}
        self._inflight: Dict[Key, Future] = {}

    def extract_streams(self, tmdb_id: int, media_type: str = "movie", season: Optional[int] = None, episode: Optional[int] = None) -> List[StreamSource]:
        def fresh():
            return self.inner.extract_streams(tmdb_id=tmdb_id, media_type=media_type, season=season, episode=episode)

        if settings.EXTRACTION_REUSE_TTL_S <= 0:
            return fresh()
        key: Key = (tmdb_id, media_type, season, episode)

        stored = self._fresh(key)
        if stored:
            age, streams = stored
            try:
                if self.validator:
                    self.validator(streams)
                note(f"Reused extraction ({age:.0f}s old): no provider contacted")
                return list(streams)
            except Exception as e:
                logger.warning(f"Stored streams for {key} no longer play: {e}")
                note(f"Stored stream URLs no longer valid ({e}): extracting again")
                with self._lock:
                    if self._entries.get(key, (0, None))[1] is streams:
                        del self._entries[key]

        with self._lock:
            fut = self._inflight.get(key)
            owner = fut is None
            if owner:
                fut = self._inflight[key] = Future()
        if not owner:
            note("Shared an extraction that was already running")
            return list(fut.result())

        try:
            streams = fresh()
        except BaseException as e:
            fut.set_exception(e)
            raise
        else:
            with self._lock:
                self._store(key, streams)
            fut.set_result(streams)
            note("Fresh extraction")
            return list(streams)
        finally:
            with self._lock:
                self._inflight.pop(key, None)

    def _fresh(self, key: Key):
        with self._lock:
            hit = self._entries.get(key)
            if not hit:
                return None
            age = self._clock() - hit[0]
            if age > settings.EXTRACTION_REUSE_TTL_S:
                del self._entries[key]
                return None
            return age, hit[1]

    def _store(self, key: Key, streams: List[StreamSource]) -> None:
        now = self._clock()
        if len(self._entries) >= MAX_ENTRIES:
            for k in [k for k, (t, _) in self._entries.items() if now - t > settings.EXTRACTION_REUSE_TTL_S] or [min(self._entries, key=lambda k: self._entries[k][0])]:
                del self._entries[k]
        self._entries[key] = (now, streams)
