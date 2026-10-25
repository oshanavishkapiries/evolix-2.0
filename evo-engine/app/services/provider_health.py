"""Cool-down for stream providers that keep failing.

`before()` decides whether a provider may be tried: healthy providers always are; after PROVIDER_FAIL_THRESHOLD
failures in a row within PROVIDER_FAIL_WINDOW_S a provider sits out for PROVIDER_COOLDOWN_S; once that has passed,
exactly one request is let through as a trial (success restores the provider, failure starts another cool-down).
State is kept in memory: a restart gives every provider a fresh start.
"""
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from app.core.config import settings


@dataclass
class _State:
    failures: List[float] = field(default_factory=list)
    cooling_until: Optional[float] = None
    trial: bool = False


class ProviderHealth:
    def __init__(self, clock: Callable[[], float] = time.time):
        self._clock = clock
        self._lock = threading.Lock()
        self._states: Dict[str, _State] = {}

    def _get(self, name: str) -> _State:
        return self._states.setdefault(name, _State())

    def before(self, name: str) -> str:
        """"go", "trial" (this request decides the provider's fate) or "skip"."""
        if settings.PROVIDER_FAIL_THRESHOLD <= 0:
            return "go"
        with self._lock:
            st = self._get(name)
            if st.trial:
                return "skip"  # a trial is already running
            if st.cooling_until is None:
                return "go"
            if self._clock() < st.cooling_until:
                return "skip"
            st.trial = True
            return "trial"

    def success(self, name: str) -> None:
        with self._lock:
            self._states[name] = _State()

    def failure(self, name: str) -> None:
        now = self._clock()
        with self._lock:
            st = self._get(name)
            if st.trial:
                st.trial = False
                st.cooling_until = now + settings.PROVIDER_COOLDOWN_S
                return
            st.failures = [t for t in st.failures if now - t <= settings.PROVIDER_FAIL_WINDOW_S] + [now]
            threshold = settings.PROVIDER_FAIL_THRESHOLD
            if threshold > 0 and len(st.failures) >= threshold:
                st.cooling_until = now + settings.PROVIDER_COOLDOWN_S
                st.failures = []

    def reset(self, name: str) -> None:
        with self._lock:
            self._states[name] = _State()

    def until(self, name: str) -> Optional[float]:
        with self._lock:
            return self._get(name).cooling_until

    def snapshot(self, names: List[str]) -> List[dict]:
        now = self._clock()
        out = []
        with self._lock:
            for name in names:
                st = self._get(name)
                if st.trial:
                    state = "trial"
                elif st.cooling_until is not None and now < st.cooling_until:
                    state = "cooling"
                elif st.cooling_until is not None:
                    state = "trial"  # cool-down over: the next request is the trial
                else:
                    state = "healthy"
                out.append({"name": name, "state": state, "cooling_until": st.cooling_until, "recent_failures": len(st.failures)})
        return out
