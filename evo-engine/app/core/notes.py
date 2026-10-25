"""Short notes an extraction leaves behind ("reused extraction", "YtHD decryptor cache hit", per-attempt metrics).

The ingest service collects them around an extraction and writes each one into the task's event log. A context
variable keeps concurrent extractions apart. Notes written from another thread (the browser pool's worker
threads) are dropped, so callers add them from the thread that called the extractor.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator, List, Optional

_current: ContextVar[Optional[List[str]]] = ContextVar("evo_notes", default=None)


@contextmanager
def collect() -> Iterator[List[str]]:
    notes: List[str] = []
    token = _current.set(notes)
    try:
        yield notes
    finally:
        _current.reset(token)


def note(message: str) -> None:
    notes = _current.get()
    if notes is not None:
        notes.append(message)
