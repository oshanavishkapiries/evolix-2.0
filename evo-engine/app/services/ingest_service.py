import logging
import re
import shutil
import time
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from app.interfaces.contracts import IStreamExtractor, IMediaDownloader, IStorageProvider
from app.interfaces.repository import ITaskRepository
from app.domain.models import IngestTask, IngestStatus, MediaType, StreamSource
from app.core.config import settings
from app.services.subtitle_service import SubtitleService
import requests

from app.services.translation_service import SinhalaTranslator
from app.services.webhook import WebhookNotifier

logger = logging.getLogger("evo.ingest")

QUALITY_FALLBACK_ORDER = ["720p", "1080p", "480p", "360p"]

# On-demand Sinhala subtitle jobs are stored as tasks (so the admin flow view shows them) under this marker
# instead of a real quality; no video request ever asks for it, so the two kinds never join each other.
SUBTITLE_JOB = "sub:si"
_CHUNK = re.compile(r"Chunk (\d+)/(\d+)")


def sanitize_filename(title: str) -> str:
    """Sanitizes movie/series titles into safe filesystem and CDN filenames."""
    # Replace unsafe characters with underscore or space
    clean = re.sub(r'[\\/*?:"<>|]', "", title)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean or "Media"


class _Limiter:
    """Counting semaphore whose limit can change while jobs run (admin-editable concurrency)."""

    def __init__(self, limit: int):
        self._cond = threading.Condition()
        self.limit = limit
        self.active = 0

    def set_limit(self, limit: int) -> None:
        with self._cond:
            self.limit = limit
            self._cond.notify_all()

    def __enter__(self):
        with self._cond:
            while self.active >= self.limit:
                self._cond.wait()
            self.active += 1

    def __exit__(self, *exc):
        with self._cond:
            self.active -= 1
            self._cond.notify_all()


class IngestService:
    """Orchestrates stream extraction, quality resolution, instant HLS streaming, downloading, and cloud syncing."""

    def __init__(
        self,
        extractor: IStreamExtractor,
        downloader: IMediaDownloader,
        storage: IStorageProvider,
        repository: ITaskRepository,
        subtitle_service: Optional[SubtitleService] = None,
        webhook: Optional[WebhookNotifier] = None,
        translator: Optional[SinhalaTranslator] = None,
    ):
        self.extractor = extractor
        self.downloader = downloader
        self.storage = storage
        self.repository = repository
        self.subtitle_service = subtitle_service or SubtitleService()
        self.webhook = webhook or WebhookNotifier()
        self.translator = translator
        # Sinhala subtitles are translated on demand (first viewer who picks them), never by the ingest pipeline.
        self._tr_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="translate")
        self._tr_locks: dict[str, threading.Lock] = {}
        self._tr_locks_guard = threading.Lock()
        # Create-or-join must be atomic or two viewers asking for the same quality start two jobs.
        self._create_lock = threading.Lock()
        # Extraction launches a headless browser and caching moves whole films: each stage has its own worker
        # pool, so waiting jobs sit in a queue (not on request threads) and a long download never blocks an extraction.
        # The pools are sized for the largest allowed concurrency; the limiters hold the live (admin-editable) limit.
        self._extract_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="extract")
        self._cache_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="cache")
        self._extract_limit = _Limiter(settings.MAX_CONCURRENT_EXTRACTIONS)
        self._cache_limit = _Limiter(settings.MAX_CONCURRENT_DOWNLOADS)
        self._queued = 0
        self._queued_guard = threading.Lock()
        self.paused = False
        self._cancelled: set[str] = set()

    def apply_config(self) -> None:
        """Pushes admin-changed concurrency limits into the running pools."""
        self._extract_limit.set_limit(settings.MAX_CONCURRENT_EXTRACTIONS)
        self._cache_limit.set_limit(settings.MAX_CONCURRENT_DOWNLOADS)

    def queue_depth(self) -> int:
        """Jobs accepted but not yet finished their extraction stage."""
        return self._queued

    def queue_status(self) -> dict:
        return {
            "paused": self.paused,
            "waiting_extraction": max(0, self._queued - self._extract_limit.active),
            "extracting": self._extract_limit.active,
            "caching": self._cache_limit.active,
            "queue_limit": settings.MAX_QUEUED_TASKS,
        }

    def enqueue(self, task_id: str) -> bool:
        """Queues a task for processing; False when the backlog is full (the caller should answer 503)."""
        with self._queued_guard:
            if self._queued >= settings.MAX_QUEUED_TASKS:
                return False
            self._queued += 1
        self._extract_pool.submit(self._run_job, task_id)
        return True

    def cancel(self, task_id: str) -> bool:
        """Stops a job before its next stage (a running extraction or download finishes its current step first)."""
        task = self.repository.get_by_id(task_id)
        if not task or task.status in (IngestStatus.COMPLETED, IngestStatus.FAILED):
            return False
        self._cancelled.add(task_id)
        self._event(task, "request", "failed", "Cancelled by an admin")
        self._set(task, IngestStatus.FAILED if not task.stream_url else None, "Cancelled by an admin")
        return True

    def _run_job(self, task_id: str) -> None:
        try:
            while self.paused and task_id not in self._cancelled:
                time.sleep(1)
            if task_id in self._cancelled:
                return
            with self._extract_limit:
                staged = self._extract_stage(task_id)
        finally:
            with self._queued_guard:
                self._queued -= 1
        if staged and task_id not in self._cancelled:
            self._cache_pool.submit(self._cache_job, *staged)

    def _cache_job(self, task: IngestTask, stream: StreamSource) -> None:
        with self._cache_limit:
            if task.task_id not in self._cancelled:
                self._cache_stage(task, stream)

    def create_task(
        self,
        tmdb_id: int,
        media_type: MediaType = MediaType.MOVIE,
        requested_quality: str = "720p",
        season: Optional[int] = None,
        episode: Optional[int] = None,
        runtime_minutes: Optional[int] = None,
        synopsis: Optional[str] = None,
        characters: Optional[List[str]] = None,
        title: Optional[str] = None,
        imdb_id: Optional[str] = None,
    ) -> IngestTask:
        with self._create_lock:
            # Join a job that is already done or in flight for this exact media & quality.
            existing = self.repository.get_by_tmdb_id(
                tmdb_id,
                media_type.value,
                requested_quality,
                season=season,
                episode=episode,
            )
            if existing:
                if existing.status == IngestStatus.COMPLETED and existing.result_url:
                    return existing
                # A streaming task whose CDN copy died is not reused: a new job retries the cache.
                if existing.status == IngestStatus.STREAMING and existing.stream_url and not existing.cache_failed:
                    return existing
                if existing.status in [IngestStatus.PENDING, IngestStatus.EXTRACTING, IngestStatus.DOWNLOADING, IngestStatus.UPLOADING]:
                    return existing

            task = IngestTask(
                task_id=str(uuid.uuid4()),
                media_type=media_type,
                tmdb_id=tmdb_id,
                requested_quality=requested_quality,
                season=season,
                episode=episode,
                runtime_minutes=runtime_minutes,
                synopsis=synopsis,
                characters=characters or [],
                title=title,
                imdb_id=imdb_id,
            )
            self.repository.save(task)
            self._event(task, "request", "ok", f"{media_type.value} tmdb {tmdb_id}" + (f" S{season}E{episode}" if season is not None else "") + f" · asked {requested_quality}")
            return task

    def get_task(self, task_id: str) -> Optional[IngestTask]:
        return self.repository.get_by_id(task_id)

    def _select_stream_with_fallback(
        self,
        streams: List[StreamSource],
        requested_quality: str,
    ) -> StreamSource:
        """Picks requested quality or falls back to next best available quality."""
        # 1. Exact match
        for s in streams:
            if s.quality.lower() == requested_quality.lower():
                return s

        # 2. Fallback cascade
        try:
            req_idx = QUALITY_FALLBACK_ORDER.index(requested_quality.lower())
            ordered_preferences = QUALITY_FALLBACK_ORDER[req_idx + 1 :] + QUALITY_FALLBACK_ORDER[:req_idx]
        except ValueError:
            ordered_preferences = QUALITY_FALLBACK_ORDER

        for q in ordered_preferences:
            for s in streams:
                if s.quality.lower() == q.lower():
                    logger.info(f"Fallback quality chosen: requested={requested_quality} -> selected={s.quality}")
                    return s

        # 3. Default to first stream
        return streams[0]

    def _event(self, task: IngestTask, step: str, state: str, detail: str = "") -> None:
        """Records a pipeline step transition for the admin flow view. Never breaks the pipeline."""
        try:
            self.repository.add_event(task.task_id, step, state, detail)
        except Exception as e:
            logger.warning(f"[{task.task_id}] could not record event {step}/{state}: {e}")

    def _set(self, task: IngestTask, status: Optional[IngestStatus] = None, message: Optional[str] = None, pct: Optional[int] = None) -> None:
        if status is not None:
            task.status = status
        if message is not None:
            task.message = message
        if pct is not None:
            task.progress_pct = pct
        task.updated_at = datetime.utcnow()
        self.repository.save(task)

    def _verify_download(self, task: IngestTask, path: Path) -> None:
        """Rejects empty/truncated files so a broken copy is never published as a source."""
        size = path.stat().st_size
        if size < 1024 * 1024:
            raise RuntimeError(f"Downloaded file is too small ({size} bytes)")
        probe = getattr(self.downloader, "probe_duration", None)
        duration = probe(path) if probe else None
        if duration is None:
            return  # no ffprobe: size check only
        # Episodes and TMDB runtimes are approximate, so only reject clearly short files.
        minimum = max(60.0, task.runtime_minutes * 60 * 0.6) if task.runtime_minutes else 60.0
        if duration < minimum:
            raise RuntimeError(f"Downloaded file is too short ({duration:.0f}s, expected at least {minimum:.0f}s)")

    def _base_name(self, task: IngestTask) -> str:
        se = f".S{task.season:02d}E{task.episode:02d}" if task.season is not None and task.episode is not None else ""
        return f"{sanitize_filename(task.title or f'Media_{task.tmdb_id}')}{se}"

    def _upload_subtitles(self, task: IngestTask, base_name: str, only: Optional[List[dict]] = None) -> List[dict]:
        """Re-hosts subtitle tracks (all of the task's, or just `only`) on the CDN. Best effort per language."""
        tracks = task.subtitles if only is None else only
        sub_dir = settings.TEMP_DIR / "subtitle_uploads" / task.task_id
        sub_dir.mkdir(parents=True, exist_ok=True)

        def upload(sub: dict) -> Optional[dict]:
            path = sub_dir / f"{base_name}.{sub['language']}.vtt"
            try:
                vtt = self.subtitle_service.get_vtt(sub["id"])
                if not vtt:
                    return None
                path.write_text(vtt, encoding="utf-8")
                res = self.storage.upload_file(path)
                return {"language": sub["language"], "label": sub["label"], "url": res.direct_url}
            except Exception as e:
                logger.warning(f"[{task.task_id}] subtitle upload failed ({sub.get('language')}): {e}")
                return None

        try:
            with ThreadPoolExecutor(max_workers=4) as pool:
                return [r for r in pool.map(upload, tracks) if r]
        finally:
            shutil.rmtree(sub_dir, ignore_errors=True)

    # ---- Sinhala translation (English subtitle -> casual Sinhala), beside the main chain

    def _tr_lock(self, key: str) -> threading.Lock:
        with self._tr_locks_guard:
            return self._tr_locks.setdefault(key, threading.Lock())

    def _translate_track(self, task: IngestTask, force: bool = False) -> Optional[dict]:
        """Translates the task's English track once per title/episode and returns the Sinhala track.

        Raises on failure (BudgetExceeded when the daily cap is hit). The per-subtitle lock makes concurrent
        requests for one title share a single translation: the later ones find the cached result.
        """
        en = next((s for s in task.subtitles if s.get("language") == "en"), None)
        if not en or not self.translator:
            return None
        si_id = en["id"].replace("_en_", "_si_", 1)
        track = {"id": si_id, "label": "Sinhala (AI)", "language": "si", "format": "vtt", "url": f"/api/v1/media/subtitles/{si_id}.vtt"}
        with self._tr_lock(si_id):
            if force:
                self.subtitle_service.delete_vtt(si_id)
            if self.subtitle_service.has_vtt(si_id):
                self._event(task, "translate", "skipped", "Already translated for this title")
            else:
                vtt = self.subtitle_service.get_vtt(en["id"])
                if not vtt:
                    raise RuntimeError("English subtitle could not be read")
                self._event(task, "translate", "running", "Translating to Sinhala")
                res = self.translator.translate_vtt(
                    vtt,
                    task.title or f"Media_{task.tmdb_id}",
                    task.synopsis or "",
                    task.characters,
                    task_id=task.task_id,
                    progress=lambda done, total: self._event(task, "translate", "running", f"Chunk {done}/{total}"),
                )
                self.subtitle_service.save_vtt(si_id, res.vtt)
                note = f" · {'; '.join(res.warnings)}" if res.warnings else ""
                self._event(task, "translate", "ok", f"{res.translated}/{res.cues} cues · ${res.cost_usd:.3f} · {res.seconds:.0f}s{note}")
        task.subtitles = [s for s in task.subtitles if s.get("language") != "si"] + [track]
        self.repository.save(task)
        return track

    def _run_translation(self, task: IngestTask, force: bool = False) -> Optional[dict]:
        """Like _translate_track, but a failure is recorded as an event and reported as None."""
        try:
            return self._translate_track(task, force)
        except Exception as e:
            logger.warning(f"[{task.task_id}] translation failed: {e}")
            self._event(task, "translate", "failed", str(e))
            return None

    # ---- On-demand Sinhala subtitles: a viewer picked "Sinhala (AI)" on a title that has no Sinhala track yet

    def sinhala_budget_left(self) -> bool:
        cap = settings.TRANSLATE_DAILY_BUDGET_USD
        return not self.translator or self.translator.repository is None or cap <= 0 or self.translator.repository.usage_today() < cap

    @staticmethod
    def _cdn_alive(url: str) -> bool:
        """Best effort: a Pixeldrain file that answers 404 is gone; any other outcome (network trouble) counts as alive."""
        m = re.search(r"pixeldrain\.com/api/file/([A-Za-z0-9_-]+)", url or "")
        if not m:
            return True
        try:
            return requests.get(f"https://pixeldrain.com/api/file/{m.group(1)}/info", timeout=6).status_code != 404
        except Exception:
            return True

    def find_sinhala_job(self, tmdb_id: int, media_type: MediaType, season: Optional[int], episode: Optional[int]) -> Optional[IngestTask]:
        return self.repository.get_by_tmdb_id(tmdb_id, media_type.value, SUBTITLE_JOB, season=season, episode=episode)

    def request_sinhala(
        self,
        tmdb_id: int,
        media_type: MediaType = MediaType.MOVIE,
        season: Optional[int] = None,
        episode: Optional[int] = None,
        title: Optional[str] = None,
        imdb_id: Optional[str] = None,
        synopsis: Optional[str] = None,
        characters: Optional[List[str]] = None,
    ) -> dict:
        """Starts (or joins) the Sinhala translation of one title/episode; returns its status (see sinhala_status).

        Works from the TMDB/IMDb ids alone, no video task needed. One job per title: a running one is joined, a
        finished one is returned as is (unless its CDN file vanished), a failed one is retried.
        """
        if not (self.translator and self.translator.enabled):
            return {"state": "unavailable", "message": "Sinhala subtitles are not available right now"}
        with self._create_lock:
            job = self.find_sinhala_job(tmdb_id, media_type, season, episode)
            if job and job.status in (IngestStatus.PENDING, IngestStatus.UPLOADING):
                return self.sinhala_status(job)
            if job and job.status == IngestStatus.COMPLETED and job.cdn_subtitles and self._cdn_alive(job.cdn_subtitles[0]["url"]):
                return self.sinhala_status(job)
            if not self.sinhala_budget_left():
                return {"state": "unavailable", "message": "Sinhala subtitles are unavailable right now, try again tomorrow"}
            job = IngestTask(
                task_id=str(uuid.uuid4()),
                media_type=media_type,
                tmdb_id=tmdb_id,
                requested_quality=SUBTITLE_JOB,
                season=season,
                episode=episode,
                title=title,
                imdb_id=imdb_id,
                synopsis=synopsis,
                characters=characters or [],
                message="Queued",
            )
            self.repository.save(job)
            self._event(job, "request", "ok", f"Sinhala subtitles · {media_type.value} tmdb {tmdb_id}" + (f" S{season}E{episode}" if season is not None else ""))
            for step in ("extract", "resolve", "stream", "cdn_check", "download", "verify", "upload"):
                self._event(job, step, "skipped", "Not needed: subtitles only")
            self._tr_pool.submit(self.process_sinhala_job, job.task_id)
        return self.sinhala_status(job)

    def sinhala_status(self, job: Optional[IngestTask]) -> dict:
        if job is None:
            return {"state": "none", "message": ""}
        out: dict = {"job_id": job.task_id, "message": job.message}
        if job.status == IngestStatus.COMPLETED and job.cdn_subtitles:
            sub = next((s for s in job.cdn_subtitles if s.get("language") == "si"), job.cdn_subtitles[0])
            return {**out, "state": "done", "subtitle": {"language": "si", "label": sub.get("label", "Sinhala (AI)"), "url": sub["url"]}}
        if job.status == IngestStatus.FAILED:
            return {**out, "state": "unavailable" if job.message.startswith("Daily translation budget") else "failed"}
        progress = None
        for e in reversed(self.repository.list_events(job.task_id)):
            m = e["step"] == "translate" and _CHUNK.search(e["detail"])
            if m:
                progress = {"done": int(m.group(1)), "total": int(m.group(2))}
                break
        return {**out, "state": "running", "progress": progress}

    def process_sinhala_job(self, job_id: str) -> None:
        job = self.repository.get_by_id(job_id)
        if not job:
            return
        step = "subtitles"
        try:
            self._set(job, IngestStatus.UPLOADING, "Finding the English subtitle")
            self._event(job, "subtitles", "running", "Searching 10 languages")
            tracks = self.subtitle_service.fetch_subtitles(job.imdb_id, season=job.season, episode=job.episode)
            job.subtitles = tracks
            if not any(t.get("language") in ("en", "si") for t in tracks):
                raise RuntimeError("This title has no English subtitle to translate from")
            self._event(job, "subtitles", "ok", f"{len(tracks)} track(s)")
            step = "translate"

            native = next((t for t in tracks if t.get("language") == "si"), None)
            if native:
                self._event(job, "translate", "skipped", "A Sinhala subtitle already exists, no translation needed")
                track = native
            else:
                self._set(job, message="Translating to Sinhala")
                track = self._translate_track(job)
                if not track:
                    raise RuntimeError("Translation produced no subtitle")

            step = "subtitle_sync"
            self._set(job, message="Uploading the Sinhala track")
            self._event(job, "subtitle_sync", "running", "Uploading the Sinhala track")
            uploaded = self._upload_subtitles(job, self._base_name(job), only=[track])
            if not uploaded:
                raise RuntimeError("Sinhala track could not be uploaded")
            job.cdn_subtitles = uploaded
            self._event(job, "subtitle_sync", "ok", "Sinhala track on the CDN")

            if settings.EVO_WEBHOOK_URL:
                self._event(job, "webhook", "running", "Registering in the app")
                ok = self.webhook.notify_subtitles(job)
                self._event(job, "webhook", "ok" if ok else "failed", "App registered the track" if ok else "App did not acknowledge (its next poll registers it)")
            else:
                self._event(job, "webhook", "skipped", "No webhook configured")
            self._set(job, IngestStatus.COMPLETED, "Sinhala subtitles ready", 100)
        except Exception as e:
            logger.warning(f"[{job_id}] Sinhala subtitle job failed: {e}")
            self._event(job, step, "failed", str(e))
            self._set(job, IngestStatus.FAILED, str(e))

    def translate_existing(self, task_id: str) -> None:
        """Adds a Sinhala track to a finished task (cached before translation existed, or a failed translation)."""
        task = self.repository.get_by_id(task_id)
        if not task or not task.result_url or not (self.translator and self.translator.enabled):
            return
        track = self._run_translation(task, force=True)  # a manual run always re-translates
        if not track:
            return
        self._event(task, "subtitle_sync", "running", "Uploading the Sinhala track")
        uploaded = self._upload_subtitles(task, self._base_name(task), only=[track])
        if not uploaded:
            self._event(task, "subtitle_sync", "failed", "Sinhala track could not be uploaded")
            return
        task.cdn_subtitles = [s for s in task.cdn_subtitles if s.get("language") != "si"] + uploaded
        self._set(task)
        self._event(task, "subtitle_sync", "ok", "Sinhala track on the CDN")
        self._event(task, "webhook", "running", "Registering in the app")
        ok = self.webhook.notify_completed(task)
        self._event(task, "webhook", "ok" if ok else "failed", "App registered the track" if ok else "App did not acknowledge")

    def _finish_completed(self, task: IngestTask, result_url: str, subs: List[dict], message: str) -> None:
        task.result_url = result_url
        task.cdn_subtitles = subs
        task.cache_failed = False
        self._set(task, IngestStatus.COMPLETED, message)
        logger.info(f"[{task.task_id}] Persistent task completed: {result_url}")
        # The app registers the file as a source; if this is lost its status poll reconciles.
        if not settings.EVO_WEBHOOK_URL:
            self._event(task, "webhook", "skipped", "No webhook configured")
            return
        self._event(task, "webhook", "running", "Registering in the app")
        if self.webhook.notify_completed(task):
            self._event(task, "webhook", "ok", "App registered the source")
        else:
            self._event(task, "webhook", "failed", "App did not acknowledge (its status poll will reconcile)")

    def process_task(self, task_id: str) -> None:
        """Runs both stages in the calling thread (tests, scripts); the service itself uses enqueue()."""
        staged = self._extract_stage(task_id)
        if staged:
            self._cache_stage(*staged)

    def _extract_stage(self, task_id: str) -> Optional[tuple]:
        """Extract streams, pick the quality, fetch subtitles and open instant playback. Returns (task, stream) for caching."""
        task = self.repository.get_by_id(task_id)
        if not task:
            logger.error(f"Task {task_id} not found")
            return None

        step = "extract"
        try:
            # 1. Extraction Phase (bounded: each one drives a headless browser)
            self._set(task, IngestStatus.EXTRACTING, "Decrypting stream sources...")
            self._event(task, "extract", "running", "Waiting for a browser slot")
            logger.info(f"[{task_id}] Extracting streams for TMDB {task.tmdb_id} (S{task.season}E{task.episode})")

            streams = self.extractor.extract_streams(
                task.tmdb_id,
                task.media_type.value,
                season=task.season,
                episode=task.episode,
            )
            if not streams:
                raise RuntimeError("No streams found for media")
            self._event(task, "extract", "ok", f"{len(streams)} stream(s): " + ", ".join(x.quality for x in streams))
            step = "resolve"

            # Resolve quality with fallback cascade
            selected_stream = self._select_stream_with_fallback(streams, task.requested_quality)
            task.resolved_quality = selected_stream.quality
            # The app's canonical title / IMDb id win: providers name titles after their own site, or omit the IMDb id.
            task.title = task.title or selected_stream.title or f"Media_{task.tmdb_id}"
            task.imdb_id = task.imdb_id or selected_stream.imdb_id
            task.upstream_stream_url = selected_stream.url
            task.upstream_headers = selected_stream.headers
            task.available_qualities = [s.quality for s in streams]
            task.variants = {s.quality: s.url for s in streams}
            self._event(
                task, "resolve", "ok",
                f"asked {task.requested_quality} -> {task.resolved_quality}" if task.requested_quality != task.resolved_quality else f"{task.resolved_quality} available",
            )
            step = "subtitles"

            # 2. Subtitles Phase (best effort, languages fetched in parallel)
            self._event(task, "subtitles", "running", "Searching 10 languages")
            try:
                task.subtitles = self.subtitle_service.fetch_subtitles(
                    task.imdb_id,
                    season=task.season,
                    episode=task.episode,
                )
                self._event(task, "subtitles", "ok", f"{len(task.subtitles)} track(s)")
            except Exception as sub_err:
                logger.warning(f"[{task_id}] Subtitle fetch failed: {sub_err}")
                task.subtitles = []
                self._event(task, "subtitles", "failed", f"{sub_err} (playback continues without subtitles)")
            self._event(task, "translate", "skipped", "Skipped (on demand): translated when a viewer picks Sinhala")
            step = "stream"

            # 3. INSTANT STREAM READY: playback does not wait for the CDN copy.
            task.stream_url = f"/api/v1/media/stream/{task.task_id}/master.m3u8"
            self._set(task, IngestStatus.STREAMING, f"Stream ready for instant playback ({task.resolved_quality})", 100)
            logger.info(f"[{task_id}] Stream is READY for instant playback: {task.stream_url} ({len(task.subtitles)} subs)")
            self._event(task, "stream", "ok", f"Viewers can watch now ({task.resolved_quality})")
            return task, selected_stream
        except Exception as e:
            logger.exception(f"[{task_id}] Extraction encountered error: {e}")
            self._event(task, step, "failed", str(e))
            self._set(task, IngestStatus.FAILED, str(e))
            return None

    def _cache_stage(self, task: IngestTask, selected_stream: StreamSource) -> None:
        """Copies the chosen quality to the CDN in the background; playback already works without it."""
        task_id = task.task_id
        local_file: Optional[Path] = None
        step = "cdn_check"
        try:
            self._event(task, "cdn_check", "running", "Checking for an existing CDN copy and free disk")

            # A different request can resolve to a quality we already cached (asked 1080p, only 720p exists).
            twin = self.repository.find_completed(
                task.tmdb_id, task.media_type.value, task.resolved_quality,
                season=task.season, episode=task.episode, exclude_task_id=task.task_id,
            )
            if twin and twin.result_url:
                logger.info(f"[{task_id}] {task.resolved_quality} is already cached by {twin.task_id}; reusing it")
                self._event(task, "cdn_check", "skipped", f"{task.resolved_quality} already cached by {twin.task_id[:8]}")
                for reused in ("download", "verify", "upload"):
                    self._event(task, reused, "skipped", "Reused the cached copy")
                twin_subs = list(twin.cdn_subtitles)
                self._event(task, "subtitle_sync", "skipped", "Reused the cached copy")
                self._finish_completed(task, twin.result_url, twin_subs, f"Already cached ({task.resolved_quality})")
                return

            # 4. Background CDN caching
            free_gb = shutil.disk_usage(settings.DOWNLOAD_DIR).free / 1024**3
            if free_gb < settings.MIN_FREE_DISK_GB:
                raise RuntimeError(f"Only {free_gb:.1f} GB free; skipping CDN cache")
            self._event(task, "cdn_check", "ok", f"No copy yet · {free_gb:.0f} GB free")

            base_name = self._base_name(task)
            formatted_filename = f"{base_name}.{task.resolved_quality}.mp4"
            # Task id in the name: two jobs for one title must never write the same file.
            local_file = settings.DOWNLOAD_DIR / f"{task.task_id[:8]}_{formatted_filename}"

            logger.info(f"[{task_id}] Background caching to CDN: {formatted_filename}")
            self._set(task, message=f"Caching {task.resolved_quality} to CDN...")

            def on_download_progress(pct: int):
                task.updated_at = datetime.utcnow()
                self.repository.save(task)

            step = "download"
            self._event(task, "download", "running", f"Remuxing {task.resolved_quality} HLS to MP4")
            self.downloader.download_stream(selected_stream, local_file, progress_callback=on_download_progress)
            self._event(task, "download", "ok", f"{local_file.stat().st_size / 1024 / 1024:.0f} MB")

            step = "verify"
            self._event(task, "verify", "running", "Checking size and duration")
            self._verify_download(task, local_file)
            self._event(task, "verify", "ok", "File looks complete")

            # 5. CDN upload (the CDN file keeps the clean name, not the scratch name)
            final_file = local_file.with_name(formatted_filename)
            local_file.rename(final_file)
            local_file = final_file
            step = "upload"
            self._event(task, "upload", "running", "Uploading to Pixeldrain")
            upload_res = self.storage.upload_file(local_file)
            self._event(task, "upload", "ok", upload_res.direct_url)

            # 6. Subtitles follow the video onto the CDN, then the task is complete
            step = "subtitle_sync"
            if task.subtitles:
                self._event(task, "subtitle_sync", "running", f"Uploading {len(task.subtitles)} track(s)")
                subs = self._upload_subtitles(task, base_name)
                self._event(task, "subtitle_sync", "ok" if subs else "failed", f"{len(subs)}/{len(task.subtitles)} track(s) on the CDN")
            else:
                subs = []
                self._event(task, "subtitle_sync", "skipped", "No subtitles to sync")
            step = "webhook"
            self._finish_completed(task, upload_res.direct_url, subs, f"Cloud sync complete: {formatted_filename}")

        except Exception as e:
            logger.exception(f"[{task_id}] Ingestion / background cache encountered error: {e}")
            self._event(task, step, "failed", str(e))
            if task.stream_url:
                # Streaming is already healthy; only the CDN copy is missing, and a new request may retry it.
                task.cache_failed = True
                self._set(task, message=f"Streaming (caching skipped: {e})")
            else:
                self._set(task, IngestStatus.FAILED, str(e))

        finally:
            # Clean up local temporary file to conserve disk space
            if local_file and local_file.exists():
                try:
                    local_file.unlink()
                    logger.info(f"[{task_id}] Cleaned up local file: {local_file.name}")
                except Exception as ex:
                    logger.warning(f"Failed to remove temp file {local_file}: {ex}")
