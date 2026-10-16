import logging
import re
import shutil
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
    ):
        self.extractor = extractor
        self.downloader = downloader
        self.storage = storage
        self.repository = repository
        self.subtitle_service = subtitle_service or SubtitleService()
        self.webhook = webhook or WebhookNotifier()
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
            )
            self.repository.save(task)
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

    def _upload_subtitles(self, task: IngestTask, base_name: str) -> List[dict]:
        """Re-hosts the task's subtitle tracks on the CDN. Best effort per language."""
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
                return [r for r in pool.map(upload, task.subtitles) if r]
        finally:
            shutil.rmtree(sub_dir, ignore_errors=True)

    def _finish_completed(self, task: IngestTask, result_url: str, subs: List[dict], message: str) -> None:
        task.result_url = result_url
        task.cdn_subtitles = subs
        task.cache_failed = False
        self._set(task, IngestStatus.COMPLETED, message)
        logger.info(f"[{task.task_id}] Persistent task completed: {result_url}")
        # The app registers the file as a source; if this is lost its status poll reconciles.
        self.webhook.notify_completed(task)

    def process_task(self, task_id: str) -> None:
        task = self.repository.get_by_id(task_id)
        if not task:
            logger.error(f"Task {task_id} not found")
            return

        local_file: Optional[Path] = None
        try:
            # 1. Extraction Phase (bounded: each one drives a headless browser)
            self._set(task, IngestStatus.EXTRACTING, "Decrypting stream sources...")
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

            # Resolve quality with fallback cascade
            selected_stream = self._select_stream_with_fallback(streams, task.requested_quality)
            task.resolved_quality = selected_stream.quality
            task.title = selected_stream.title or f"Media_{task.tmdb_id}"
            task.imdb_id = selected_stream.imdb_id
            task.upstream_stream_url = selected_stream.url
            task.upstream_headers = selected_stream.headers
            task.available_qualities = [s.quality for s in streams]
            task.variants = {s.quality: s.url for s in streams}

            # 2. Subtitles Phase (best effort, languages fetched in parallel)
            try:
                task.subtitles = self.subtitle_service.fetch_subtitles(
                    task.imdb_id,
                    season=task.season,
                    episode=task.episode,
                )
            except Exception as sub_err:
                logger.warning(f"[{task_id}] Subtitle fetch failed: {sub_err}")
                task.subtitles = []

            # 3. INSTANT STREAM READY: playback does not wait for the CDN copy.
            task.stream_url = f"/api/v1/media/stream/{task.task_id}/master.m3u8"
            self._set(task, IngestStatus.STREAMING, f"Stream ready for instant playback ({task.resolved_quality})", 100)
            logger.info(f"[{task_id}] Stream is READY for instant playback: {task.stream_url} ({len(task.subtitles)} subs)")

            # A different request can resolve to a quality we already cached (asked 1080p, only 720p exists).
            twin = self.repository.find_completed(
                task.tmdb_id, task.media_type.value, task.resolved_quality,
                season=task.season, episode=task.episode, exclude_task_id=task.task_id,
            )
            if twin and twin.result_url:
                logger.info(f"[{task_id}] {task.resolved_quality} is already cached by {twin.task_id}; reusing it")
                self._finish_completed(task, twin.result_url, twin.cdn_subtitles, f"Already cached ({task.resolved_quality})")
                return

            # 4. Background CDN caching
            free_gb = shutil.disk_usage(settings.DOWNLOAD_DIR).free / 1024**3
            if free_gb < settings.MIN_FREE_DISK_GB:
                raise RuntimeError(f"Only {free_gb:.1f} GB free; skipping CDN cache")

            clean_title = sanitize_filename(task.title)
            se_suffix = f".S{task.season:02d}E{task.episode:02d}" if task.season is not None and task.episode is not None else ""
            base_name = f"{clean_title}{se_suffix}"
            formatted_filename = f"{base_name}.{task.resolved_quality}.mp4"
            # Task id in the name: two jobs for one title must never write the same file.
            local_file = settings.DOWNLOAD_DIR / f"{task.task_id[:8]}_{formatted_filename}"

            with self._cache_slots:
                logger.info(f"[{task_id}] Background caching to CDN: {formatted_filename}")
                self._set(task, message=f"Caching {task.resolved_quality} to CDN...")

                def on_download_progress(pct: int):
                    task.updated_at = datetime.utcnow()
                    self.repository.save(task)

                self.downloader.download_stream(selected_stream, local_file, progress_callback=on_download_progress)
                self._verify_download(task, local_file)

                # 5. CDN upload (the CDN file keeps the clean name, not the scratch name)
                final_file = local_file.with_name(formatted_filename)
                local_file.rename(final_file)
                local_file = final_file
                upload_res = self.storage.upload_file(local_file)

            # 6. Subtitles follow the video onto the CDN, then the task is complete
            subs = self._upload_subtitles(task, base_name) if task.subtitles else []
            self._finish_completed(task, upload_res.direct_url, subs, f"Cloud sync complete: {formatted_filename}")

        except Exception as e:
            logger.exception(f"[{task_id}] Ingestion / background cache encountered error: {e}")
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
