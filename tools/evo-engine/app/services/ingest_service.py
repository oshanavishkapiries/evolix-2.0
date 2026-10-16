import logging
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from app.interfaces.contracts import IStreamExtractor, IMediaDownloader, IStorageProvider
from app.interfaces.repository import ITaskRepository
from app.domain.models import IngestTask, IngestStatus, MediaType, StreamSource
from app.core.config import settings
from app.services.subtitle_service import SubtitleService

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
    ):
        self.extractor = extractor
        self.downloader = downloader
        self.storage = storage
        self.repository = repository
        self.subtitle_service = subtitle_service or SubtitleService()

    def create_task(
        self,
        tmdb_id: int,
        media_type: MediaType = MediaType.MOVIE,
        requested_quality: str = "720p",
        season: Optional[int] = None,
        episode: Optional[int] = None,
    ) -> IngestTask:
        # Check if already completed or currently in progress for this exact media & quality
        existing = self.repository.get_by_tmdb_id(
            tmdb_id,
            media_type.value,
            requested_quality,
            season=season,
            episode=episode,
        )
        if existing:
            if existing.status in [IngestStatus.COMPLETED, IngestStatus.STREAMING] and (existing.result_url or existing.stream_url):
                return existing
            if existing.status in [IngestStatus.PENDING, IngestStatus.EXTRACTING, IngestStatus.DOWNLOADING, IngestStatus.UPLOADING]:
                return existing

        task_id = str(uuid.uuid4())
        task = IngestTask(
            task_id=task_id,
            media_type=media_type,
            tmdb_id=tmdb_id,
            requested_quality=requested_quality,
            season=season,
            episode=episode,
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

    def process_task(self, task_id: str) -> None:
        task = self.repository.get_by_id(task_id)
        if not task:
            logger.error(f"Task {task_id} not found")
            return

        local_file: Optional[Path] = None
        try:
            # 1. Extraction Phase
            task.status = IngestStatus.EXTRACTING
            task.message = "Decrypting stream sources..."
            task.updated_at = datetime.utcnow()
            self.repository.save(task)
            logger.info(f"[{task_id}] Extracting streams for TMDB {task.tmdb_id} (S{task.season}E{task.episode})")

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

            # 2. Subtitles Phase (Non-blocking, best effort)
            try:
                task.subtitles = self.subtitle_service.fetch_subtitles(
                    task.imdb_id,
                    season=task.season,
                    episode=task.episode,
                )
            except Exception as sub_err:
                logger.warning(f"[{task_id}] Subtitle fetch failed: {sub_err}")
                task.subtitles = []

            # 3. INSTANT STREAM READY: Enable playback immediately without waiting for download/upload!
            task.status = IngestStatus.STREAMING
            task.stream_url = f"/api/v1/media/stream/{task.task_id}/master.m3u8"
            task.message = f"Stream ready for instant playback ({task.resolved_quality})"
            task.progress_pct = 100
            task.updated_at = datetime.utcnow()
            self.repository.save(task)
            logger.info(f"[{task_id}] Stream is READY for instant playback: {task.stream_url} ({len(task.subtitles)} subs)")

            # 4. Background Persistent Ingestion Phase (Optional cloud caching)
            clean_title = sanitize_filename(task.title)
            se_suffix = f".S{task.season:02d}E{task.episode:02d}" if task.season and task.episode else ""
            formatted_filename = f"{clean_title}{se_suffix}.{task.resolved_quality}.mp4"
            local_file = settings.DOWNLOAD_DIR / formatted_filename

            logger.info(f"[{task_id}] Background caching to CDN: {formatted_filename}")

            def on_download_progress(pct: int):
                # Don't revert progress if already streaming
                task.updated_at = datetime.utcnow()
                self.repository.save(task)

            self.downloader.download_stream(
                selected_stream,
                local_file,
                progress_callback=on_download_progress,
            )

            # 5. Background CDN Upload
            upload_res = self.storage.upload_file(local_file)

            # 6. Completed Phase (Persistent direct URL available)
            task.status = IngestStatus.COMPLETED
            task.message = f"Cloud sync complete: {formatted_filename}"
            task.result_url = upload_res.direct_url
            task.updated_at = datetime.utcnow()
            self.repository.save(task)
            logger.info(f"[{task_id}] Persistent task completed: {upload_res.direct_url}")

        except Exception as e:
            logger.exception(f"[{task_id}] Ingestion / background cache encountered error: {e}")
            if task.stream_url:
                # Instant streaming is already active and healthy; don't mark as FAILED
                task.message = f"Streaming active (background caching skipped: {e})"
                task.updated_at = datetime.utcnow()
                self.repository.save(task)
            else:
                task.status = IngestStatus.FAILED
                task.message = str(e)
                task.updated_at = datetime.utcnow()
                self.repository.save(task)

        finally:
            # Clean up local temporary file to conserve disk space
            if local_file and local_file.exists():
                try:
                    local_file.unlink()
                    logger.info(f"[{task_id}] Cleaned up local file: {local_file.name}")
                except Exception as ex:
                    logger.warning(f"Failed to remove temp file {local_file}: {ex}")
