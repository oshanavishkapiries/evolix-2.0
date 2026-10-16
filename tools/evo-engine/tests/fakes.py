import tempfile
import threading
from pathlib import Path

from app.core.config import settings
from app.domain.models import StreamSource, UploadResult
from app.services.ingest_service import IngestService
from app.services.sqlite_repository import SQLiteTaskRepository
from app.services.translation_service import BudgetExceeded, TranslationResult

settings.DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)

VTT = "WEBVTT\n\n1\n00:01:00.000 --> 00:01:02.000\nHello there.\n\n2\n00:01:03.000 --> 00:01:05.000\nGoodbye.\n"


class Extractor:
    def extract_streams(self, tmdb, media_type, season=None, episode=None):
        return [StreamSource(url="https://cdn/720.m3u8", quality="720p", title="Test Movie", imdb_id="tt0123456")]


class Downloader:
    def download_stream(self, stream, out, progress_callback=None):
        out.write_bytes(b"x" * (2 * 1024 * 1024))
        return out

    def probe_duration(self, path):
        return 6000.0


class Storage:
    def __init__(self):
        self.files = []

    def upload_file(self, path, progress_callback=None):
        self.files.append(path.name)
        return UploadResult("pixeldrain", f"id{len(self.files)}", f"https://pixeldrain.com/api/file/id{len(self.files)}", path.stat().st_size)


class Subtitles:
    """OpenSubtitles stand-in. `tracks` is what a search finds; every track reads as the same small VTT."""

    def __init__(self, tracks=None):
        self.tracks = tracks if tracks is not None else [
            {"id": "sub_123456_en_1", "label": "English", "language": "en", "format": "vtt", "url": "/x"},
            {"id": "sub_123456_es_2", "label": "Spanish", "language": "es", "format": "vtt", "url": "/y"},
        ]
        self.saved = {}

    def fetch_subtitles(self, imdb, season=None, episode=None):
        return list(self.tracks)

    def get_vtt(self, sub_id):
        return self.saved.get(sub_id, VTT)

    def has_vtt(self, sub_id):
        return sub_id in self.saved

    def delete_vtt(self, sub_id):
        self.saved.pop(sub_id, None)

    def save_vtt(self, sub_id, vtt):
        self.saved[sub_id] = vtt


class Hook:
    def __init__(self):
        self.completed, self.subtitles = [], []

    def notify_completed(self, task):
        self.completed.append(task.task_id)
        return True

    def notify_subtitles(self, task):
        self.subtitles.append(task.task_id)
        return True


class Translator:
    """Stands in for SinhalaTranslator: counts calls, reports chunk progress, can block or run out of budget."""

    enabled = True

    def __init__(self, repository, cost=0.01, gate=None, error=None):
        self.repository = repository
        self.calls = 0
        self.cost = cost
        self.gate = gate  # threading.Event the translation waits for
        self.error = error

    def translate_vtt(self, vtt, title, synopsis="", characters=None, task_id=None, progress=None):
        self.calls += 1
        if progress:
            progress(1, 2)
        if self.gate:
            assert self.gate.wait(10), "test never released the translation"
        if self.error:
            raise self.error
        self.repository.add_usage(task_id, "fake", self.cost, 10)
        if progress:
            progress(2, 2)
        return TranslationResult(vtt="WEBVTT\n\n1\n00:01:00.000 --> 00:01:02.000\nSinhala\n", cues=2, translated=2, cost_usd=self.cost, seconds=0.1)


def make_service(translator_factory=Translator, subtitles=None, hook=None, **translator_kw):
    repo = SQLiteTaskRepository(Path(tempfile.mkdtemp(dir=settings.TEMP_DIR)) / "t.sqlite3")
    translator = translator_factory(repo, **translator_kw) if translator_factory else None
    svc = IngestService(Extractor(), Downloader(), Storage(), repo, subtitles or Subtitles(), hook or Hook(), translator)
    return svc, repo, translator


def wait_until(svc, status_fn, states=("done", "failed", "unavailable"), timeout=10):
    done = threading.Event()
    result = {}

    def loop():
        import time

        end = time.time() + timeout
        while time.time() < end:
            st = status_fn()
            if st["state"] in states:
                result.update(st)
                break
            time.sleep(0.02)
        done.set()

    threading.Thread(target=loop, daemon=True).start()
    done.wait(timeout + 1)
    return result


__all__ = ["make_service", "wait_until", "Translator", "Subtitles", "Hook", "BudgetExceeded"]
