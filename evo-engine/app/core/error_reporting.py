"""Sends engine errors to the app's error tracker (POST {app}/api/errors, authenticated with X-Evo-Secret).

Attached to the root logger, so anything logged at ERROR with a traceback is reported: background job failures
(logger.exception) as well as unhandled request errors (uvicorn logs those the same way). Non-blocking, deduplicated.
"""

import linecache
import logging
import os
import queue
import threading
import time
import traceback
from urllib.parse import urlsplit

import requests

from app.core.config import BASE_DIR, settings

CONTEXT = 5
PER_MINUTE = 20


def errors_endpoint() -> str:
    """ERROR_REPORT_URL, else derived from the completion webhook (same app): https://app/api/errors."""
    if settings.ERROR_REPORT_URL:
        return settings.ERROR_REPORT_URL
    if not settings.EVO_WEBHOOK_URL:
        return ""
    u = urlsplit(settings.EVO_WEBHOOK_URL)
    return f"{u.scheme}://{u.netloc}/api/errors"


def _frames(tb) -> list[dict]:
    out = []
    root = str(BASE_DIR)
    for f in traceback.extract_tb(tb):
        in_app = f.filename.startswith(root) and "site-packages" not in f.filename and ".venv" not in f.filename
        file = os.path.relpath(f.filename, root) if f.filename.startswith(root) else f.filename
        frame = {"fn": f.name, "file": f"evo-engine/{file}" if in_app else file, "line": f.lineno, "col": None, "inApp": in_app}
        if in_app and f.lineno:
            start = max(1, f.lineno - CONTEXT)
            lines = [linecache.getline(f.filename, n).rstrip("\n")[:300] for n in range(start, f.lineno + CONTEXT + 1)]
            frame["context"] = {"start": start, "lines": lines}
        out.append(frame)
    out.reverse()  # innermost first, like JS stacks
    return out[:60]


class AppErrorHandler(logging.Handler):
    def __init__(self, url: str):
        super().__init__(level=logging.ERROR)
        self.url = url
        self.q: queue.Queue = queue.Queue(maxsize=100)
        self.window = (0.0, 0)
        self.recent: dict[str, float] = {}
        threading.Thread(target=self._worker, name="error-reporter", daemon=True).start()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            if record.name.startswith("evo.error_reporting") or not record.exc_info or not record.exc_info[1]:
                return
            exc_type, exc, tb = record.exc_info
            last = traceback.extract_tb(tb)[-1] if tb else None
            key = f"{exc_type.__name__}:{exc}:{last.filename if last else record.pathname}:{last.lineno if last else record.lineno}"
            now = time.time()
            if self.recent.get(key, 0) > now - 30:
                return
            self.recent[key] = now
            if len(self.recent) > 500:
                self.recent.clear()
            start, n = self.window
            if now - start > 60:
                self.window = (now, 1)
            elif n >= PER_MINUTE:
                return
            else:
                self.window = (start, n + 1)
            stack = "".join(traceback.format_exception(exc_type, exc, tb))[-20000:]
            self.q.put_nowait({
                "type": exc_type.__name__,
                "message": str(exc)[:4000] or exc_type.__name__,
                "stack": stack,
                "level": "fatal" if record.levelno >= logging.CRITICAL else "error",
                "route": f"engine {record.name}",
                "frames": _frames(tb),
                "breadcrumbs": [{"t": int(record.created * 1000), "type": "log", "message": record.getMessage()[:500], "level": "error"}],
                "context": {"logger": record.name, "thread": record.threadName, "engine": settings.ENGINE_NAME or os.uname().nodename},
            })
        except Exception:
            pass

    def _worker(self) -> None:
        while True:
            body = self.q.get()
            try:
                requests.post(self.url, json=body, headers={"X-Evo-Secret": settings.EVO_SECRET_TOKEN}, timeout=10)
            except Exception:
                pass


def install() -> None:
    url = errors_endpoint()
    if not url or not settings.EVO_SECRET_TOKEN:
        logging.getLogger("evo.error_reporting").info("Error reporting off (needs EVO_SECRET_TOKEN and ERROR_REPORT_URL or EVO_WEBHOOK_URL)")
        return
    logging.getLogger().addHandler(AppErrorHandler(url))
    logging.getLogger("evo.error_reporting").info(f"Reporting errors to {url}")
