"""A real engine app whose network-facing parts (providers, FFmpeg, CDN, OpenSubtitles, OpenRouter) are stubs.

Used to exercise multi-engine behaviour from the app without internet or spend:

    SQLITE_DB_PATH=... DOWNLOAD_DIR=... TEMP_DIR=... STUB_EXTRACT_SECONDS=2 \\
        uvicorn stub_engine:app --port 8001

Every extraction takes STUB_EXTRACT_SECONDS, so queues build up and the app's capacity-based scheduling can be seen.
"""
import os
import time
import uuid

from app.api import routes
from app.domain.models import UploadResult
from app.main import app  # noqa: F401  (uvicorn imports `app` from this module)
from app.services.webhook import WebhookNotifier
import importlib.util
from pathlib import Path

# tests/fakes.py is loaded by path: importing the `tests` package would replace this engine's settings with a sandbox.
_spec = importlib.util.spec_from_file_location("evo_stub_fakes", Path(__file__).parent / "tests" / "fakes.py")
fakes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fakes)

_delay = float(os.environ.get("STUB_EXTRACT_SECONDS", "1"))


class SlowExtractor(fakes.Extractor):
    def extract_streams(self, tmdb, media_type, season=None, episode=None):
        time.sleep(_delay)
        return super().extract_streams(tmdb, media_type, season, episode)


class StubDownloader(fakes.Downloader):
    def probe_duration(self, path):
        return 100_000.0  # long enough to pass the "not truncated" check for any runtime


class StubStorage(fakes.Storage):
    """Hands out Pixeldrain-looking URLs (the app only registers URLs of that shape)."""

    def upload_file(self, path, progress_callback=None):
        fid = "stub" + uuid.uuid4().hex[:8]
        self.files.append(path.name)
        return UploadResult("pixeldrain", fid, f"https://pixeldrain.com/api/file/{fid}", path.stat().st_size)


_svc = routes._service_instance
_svc.extractor = SlowExtractor()
_svc.downloader = StubDownloader()
_svc.storage = StubStorage()
_svc.subtitle_service = fakes.Subtitles()
_svc.translator = fakes.Translator(routes._repository)
_svc.webhook = WebhookNotifier()  # the real one: completions reach the app's /api/evo/complete
