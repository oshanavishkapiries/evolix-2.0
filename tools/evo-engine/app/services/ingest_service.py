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

logger = logging.getLogger("evo.ingest")

QUALITY_FALLBACK_ORDER = ["1080p", "720p", "480p", "360p"]


def sanitize_filename(title: str) -> str:
    """Sanitizes movie/series titles into safe filesystem and CDN filenames."""
    # Replace unsafe characters with underscore or space
    clean = re.sub(r'[\\/*?:"<>|]', "", title)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean or "Media"


class IngestService:
    """Orchestrates stream extraction, quality resolution, downloading, and cloud syncing.

    Follows Dependency Inversion: depends on abstractions (interfaces),
    not on concrete classes.
    """

    def __init__(
        self,
        extractor: IStreamExtractor,
        downloader: IMediaDownloader,
        storage: IStorageProvider,
        repository: ITaskRepository,
    ):
        self.extractor = extractor
        self.downloader = downloader
        self.storage = storage
        self.repository = repository

    def create_task(
        self,
        tmdb_id: int,
        media_type: MediaType = MediaType.MOVIE,
        requested_quality: str = "1080p",
    ) -> IngestTask:
        # Check if already completed with this quality
        existing = self.repository.get_by_tmdb_id(tmdb_id, media_type.value)
        if existing and existing.status == IngestStatus.COMPLETED and existing.resolved_quality == requested_quality:
            return existing

        task_id = str(uuid.uuid4())
        task = IngestTask(
            task_id=task_id,
            media_type=media_type,
            tmdb_id=tmdb_id,
            requested_quality=requested_quality,
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
            logger.info(f"[{task_id}] Extracting streams for TMDB {task.tmdb_id}")

            streams = self.extractor.extract_streams(task.tmdb_id, task.media_type.value)
            if not streams:
                raise RuntimeError("No streams found for media")

            # Resolve quality with fallback cascade
            selected_stream = self._select_stream_with_fallback(streams, task.requested_quality)
            task.resolved_quality = selected_stream.quality
            task.title = selected_stream.title or f"Media_{task.tmdb_id}"

            # 2. Naming convention: Title.Quality.mp4 (e.g., "Matchbox the Movie 2026.1080p.mp4")
            clean_title = sanitize_filename(task.title)
            formatted_filename = f"{clean_title}.{task.resolved_quality}.mp4"
            local_file = settings.DOWNLOAD_DIR / formatted_filename

            # 3. Downloading Phase
            task.status = IngestStatus.DOWNLOADING
            task.message = f"Downloading stream: {formatted_filename}"
            task.updated_at = datetime.utcnow()
            self.repository.save(task)
            logger.info(f"[{task_id}] Downloading stream ({selected_stream.quality}) to {local_file.name}")

            def on_download_progress(pct: int):
                task.progress_pct = int(pct * 0.5)  # 0 - 50%
                task.updated_at = datetime.utcnow()
                self.repository.save(task)

            self.downloader.download_stream(
                selected_stream,
                local_file,
                progress_callback=on_download_progress,
            )

            # 4. Uploading Phase
            task.status = IngestStatus.UPLOADING
            task.message = f"Uploading to CDN: {formatted_filename}"
            task.updated_at = datetime.utcnow()
            self.repository.save(task)
            logger.info(f"[{task_id}] Uploading file to CDN: {local_file.name}")

            def on_upload_progress(pct: int):
                task.progress_pct = 50 + int(pct * 0.5)  # 50 - 100%
                task.updated_at = datetime.utcnow()
                self.repository.save(task)

            upload_res = self.storage.upload_file(
                local_file,
                progress_callback=on_upload_progress,
            )

            # 5. Completed Phase
            task.status = IngestStatus.COMPLETED
            task.progress_pct = 100
            task.message = f"Sync complete: {formatted_filename}"
            task.result_url = upload_res.direct_url
            task.updated_at = datetime.utcnow()
            self.repository.save(task)
            logger.info(f"[{task_id}] Task completed: {upload_res.direct_url}")

        except Exception as e:
            logger.exception(f"[{task_id}] Ingestion failed: {e}")
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
