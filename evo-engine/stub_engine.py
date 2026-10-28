"""A real engine app whose network-facing parts (providers, FFmpeg, CDN, OpenSubtitles, OpenRouter) are stubs.

Used to exercise multi-engine behaviour from the app without internet or spend:

    SQLITE_DB_PATH=... DOWNLOAD_DIR=... TEMP_DIR=... STUB_EXTRACT_SECONDS=2 \\
        uvicorn stub_engine:app --port 8001

Every extraction takes STUB_EXTRACT_SECONDS, so queues build up and the app's capacity-based scheduling can be seen.
"""
import os
import time
import uuid
import tempfile
import hashlib
from urllib.parse import urlparse
from pathlib import Path

# Ignore service credentials and paths in .env. Only an explicitly configured local app receives webhooks.
_hook = os.environ.get("EVO_WEBHOOK_URL", "")
if _hook and urlparse(_hook).hostname not in ("localhost", "127.0.0.1", "::1"):
    raise RuntimeError("The stub engine only sends webhooks to a local app")
_root = Path(tempfile.mkdtemp(prefix="evo-stub-"))
for _name, _value in {
    "SQLITE_DB_PATH": str(_root / "engine.sqlite3"), "TEMP_DIR": str(_root / "temp"),
    "DOWNLOAD_DIR": str(_root / "downloads"), "EVO_SECRET_TOKEN": "stub-local-only",
}.items():
    os.environ.setdefault(_name, _value)
os.environ.update({"EVO_WEBHOOK_URL": _hook, "ERROR_REPORT_URL": "", "OPENROUTER_API_KEY": "", "PIXELDRAIN_API_KEY": ""})

from app.api import routes
from app.domain.models import UploadResult
from app.main import app  # noqa: F401  (uvicorn imports `app` from this module)
from app.services.webhook import WebhookNotifier
from app.services.subtitle_service import validate_subtitle
import importlib.util

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

    def delete_file(self, file_id):
        pass


class StubSubtitles(fakes.Subtitles):
    def __init__(self):
        super().__init__()
        self._meta_cache = {}

    def _save_meta(self):
        pass

    def search_candidates(self, imdb_id, language="en", season=None, episode=None):
        return [{"ref": t["id"], "release": f"Stub {t['label']}", "downloads": 100, "rating": 8, "lang": t["language"], "fileName": "stub.srt"}
                for t in self.tracks if t["language"] == language]

    def store_upload(self, raw, episode=False, runtime_minutes=None):
        sub_id = "upload_" + hashlib.sha256(raw).hexdigest()
        self.save_vtt(sub_id, validate_subtitle(raw, episode, runtime_minutes))
        return sub_id

    def forget_publication(self, url):
        for entry in self._meta_cache.values():
            if entry.get("cdn_url") == url:
                entry.pop("cdn_url", None)


_svc = routes._service_instance
_svc.extractor = SlowExtractor()
_svc.downloader = StubDownloader()
_svc.storage = StubStorage()
_svc.subtitle_service = StubSubtitles()
routes._subtitle_service = _svc.subtitle_service
routes._storage = _svc.storage
_svc._cdn_alive = lambda url: True
_svc.translator = fakes.Translator(routes._repository)
_svc.webhook = WebhookNotifier()  # the real one: completions reach the app's /api/evo/complete
