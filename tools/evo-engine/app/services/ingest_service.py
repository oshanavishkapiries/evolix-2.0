import logging
import re
import shutil
import threading
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from app.interfaces.contracts import IStreamExtractor, IMediaDownloader, IStorageProvider
from app.interfaces.repository import ITaskRepository
from app.domain.models import IngestTask, IngestStatus, MediaType, StreamSource
from app.core.config import settings
from app.services.subtitle_service import SubtitleService
from app.services.translation_service import SinhalaTranslator
from app.services.webhook import WebhookNotifier

logger = logging.getLogger("evo.ingest")

QUALITY_FALLBACK_ORDER = ["720p", "1080p", "480p", "360p"]


def sanitize_filename(title: str) -> str:
    """Sanitizes movie/series titles into safe filesystem and CDN filenames."""
    # Replace unsafe characters with underscore or space
    clean = re.sub(r'[\\/*?:"<>|]', "", title)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean or "Media"


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
        # Translation runs beside the main chain; the CDN sync step waits for it (bounded) so the Sinhala track ships too.
        self._tr_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="translate")
        self._translations: dict[str, Future] = {}
        self._tr_locks: dict[str, threading.Lock] = {}
        self._tr_locks_guard = threading.Lock()
        # Create-or-join must be atomic or two viewers asking for the same quality start two jobs.
        self._create_lock = threading.Lock()
        # Extraction launches a headless browser and caching moves whole films: bound both.
        self._extract_slots = threading.BoundedSemaphore(settings.MAX_CONCURRENT_EXTRACTIONS)
        self._cache_slots = threading.BoundedSemaphore(settings.MAX_CONCURRENT_DOWNLOADS)

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

    def _start_translation(self, task: IngestTask) -> None:
        if not (self.translator and self.translator.enabled):
            self._event(task, "translate", "skipped", "Translation is not configured (OPENROUTER_API_KEY)")
            return
        if not any(s.get("language") == "en" for s in task.subtitles):
            self._event(task, "translate", "skipped", "No English subtitles to translate")
            return
        self._event(task, "translate", "running", "Queued")
        self._translations[task.task_id] = self._tr_pool.submit(self._run_translation, task)

    def _run_translation(self, task: IngestTask, force: bool = False) -> Optional[dict]:
        """Translates the task's English track once per title/episode; returns the Sinhala track or None."""
        en = next((s for s in task.subtitles if s.get("language") == "en"), None)
        if not en or not self.translator:
            return None
        si_id = en["id"].replace("_en_", "_si_", 1)
        track = {"id": si_id, "label": "Sinhala (AI)", "language": "si", "format": "vtt", "url": f"/api/v1/media/subtitles/{si_id}.vtt"}
        try:
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
        except Exception as e:
            logger.warning(f"[{task.task_id}] translation failed: {e}")
            self._event(task, "translate", "failed", str(e))
            return None

    def _await_translation(self, task: IngestTask) -> Optional[dict]:
        fut = self._translations.pop(task.task_id, None)
        if fut is None:
            return None
        try:
            return fut.result(timeout=settings.TRANSLATE_SYNC_WAIT_SECONDS)
        except Exception as e:
            logger.warning(f"[{task.task_id}] gave up waiting for translation: {e}")
            return None

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
        task = self.repository.get_by_id(task_id)
        if not task:
            logger.error(f"Task {task_id} not found")
            return

        local_file: Optional[Path] = None
        step = "extract"
        try:
            # 1. Extraction Phase (bounded: each one drives a headless browser)
            self._set(task, IngestStatus.EXTRACTING, "Decrypting stream sources...")
            self._event(task, "extract", "running", "Waiting for a browser slot")
            logger.info(f"[{task_id}] Extracting streams for TMDB {task.tmdb_id} (S{task.season}E{task.episode})")

            with self._extract_slots:
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
            self._start_translation(task)
            step = "stream"

            # 3. INSTANT STREAM READY: playback does not wait for the CDN copy.
            task.stream_url = f"/api/v1/media/stream/{task.task_id}/master.m3u8"
            self._set(task, IngestStatus.STREAMING, f"Stream ready for instant playback ({task.resolved_quality})", 100)
            logger.info(f"[{task_id}] Stream is READY for instant playback: {task.stream_url} ({len(task.subtitles)} subs)")
            self._event(task, "stream", "ok", f"Viewers can watch now ({task.resolved_quality})")
            step = "cdn_check"
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
                si_track = self._await_translation(task)
                if si_track and not any(x.get("language") == "si" for x in twin_subs):
                    twin_subs += self._upload_subtitles(task, self._base_name(task), only=[si_track])
                    self._event(task, "subtitle_sync", "ok", "Added the Sinhala track")
                else:
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

            with self._cache_slots:
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
            self._await_translation(task)
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
