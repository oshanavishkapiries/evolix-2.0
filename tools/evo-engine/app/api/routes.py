from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends
from app.api.schemas import IngestRequest, IngestResponse, TaskStatusResponse
from app.services.ingest_service import IngestService
from app.services.ythd_extractor import YtHdStreamExtractor
from app.services.ffmpeg_downloader import FFmpegStreamDownloader
from app.services.pixeldrain_storage import PixeldrainStorageProvider
from app.services.sqlite_repository import SQLiteTaskRepository
from app.core.config import settings

router = APIRouter(prefix="/api/v1/media", tags=["Media Ingestion"])


def get_ingest_service() -> IngestService:
    extractor = YtHdStreamExtractor()
    downloader = FFmpegStreamDownloader()
    storage = PixeldrainStorageProvider(api_key=settings.PIXELDRAIN_API_KEY)
    repository = SQLiteTaskRepository(db_path=settings.SQLITE_DB_PATH)
    return IngestService(
        extractor=extractor,
        downloader=downloader,
        storage=storage,
        repository=repository,
    )


_service_instance = get_ingest_service()


@router.post("/ingest", response_model=IngestResponse)
def trigger_media_ingestion(
    request: IngestRequest,
    background_tasks: BackgroundTasks,
):
    """Triggers asynchronous on-demand media download, quality selection, and CDN upload."""
    task = _service_instance.create_task(
        tmdb_id=request.tmdb_id,
        media_type=request.media_type,
        requested_quality=request.quality,
    )
    background_tasks.add_task(_service_instance.process_task, task.task_id)

    return IngestResponse(
        task_id=task.task_id,
        status=task.status,
        requested_quality=task.requested_quality,
        message=f"Media ingestion queued in background (Target quality: {task.requested_quality})",
    )


@router.get("/status/{task_id}", response_model=TaskStatusResponse)
def get_ingest_task_status(task_id: str):
    """Polls the live progress and result of an ingestion job."""
    task = _service_instance.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Ingest task not found")

    return TaskStatusResponse(
        task_id=task.task_id,
        tmdb_id=task.tmdb_id,
        media_type=task.media_type,
        requested_quality=task.requested_quality,
        resolved_quality=task.resolved_quality,
        title=task.title,
        status=task.status,
        progress_pct=task.progress_pct,
        message=task.message,
        result_url=task.result_url,
    )
