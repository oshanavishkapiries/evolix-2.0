from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends, Header, Response, Query
from typing import Optional
from app.api.schemas import IngestRequest, IngestResponse, TaskStatusResponse, TaskSummary
from app.domain.models import IngestStatus
from app.services.ingest_service import IngestService
from app.services.cinesrc_extractor import CineSrcStreamExtractor
from app.services.composite_extractor import CompositeStreamExtractor
from app.services.stream_validator import validate_streams
from app.services.ythd_extractor import YtHdStreamExtractor
from app.services.ffmpeg_downloader import FFmpegStreamDownloader
from app.services.pixeldrain_storage import PixeldrainStorageProvider
from app.services.sqlite_repository import SQLiteTaskRepository
from app.services.subtitle_service import SubtitleService
from app.services.hls_proxy import HlsProxyService
from app.services.translation_service import SinhalaTranslator
from app.core.config import settings

router = APIRouter(prefix="/api/v1/media", tags=["Media Ingestion & Streaming"])


def verify_secret_token(x_evo_secret: Optional[str] = Header(None, alias="X-Evo-Secret")):
    if settings.EVO_SECRET_TOKEN and x_evo_secret != settings.EVO_SECRET_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid Evo Secret Token")
    return True


_repository = SQLiteTaskRepository(db_path=settings.SQLITE_DB_PATH)
_subtitle_service = SubtitleService()
_hls_proxy = HlsProxyService()
_cinesrc_extractor = CineSrcStreamExtractor()
_ythd_extractor = YtHdStreamExtractor()
_extractor = CompositeStreamExtractor([_cinesrc_extractor, _ythd_extractor], validator=validate_streams)
_downloader = FFmpegStreamDownloader()
_storage = PixeldrainStorageProvider(api_key=settings.PIXELDRAIN_API_KEY)
_translator = SinhalaTranslator(repository=_repository)

_service_instance = IngestService(
    extractor=_extractor,
    downloader=_downloader,
    storage=_storage,
    repository=_repository,
    subtitle_service=_subtitle_service,
    translator=_translator,
)


@router.post("/ingest", response_model=IngestResponse, dependencies=[Depends(verify_secret_token)])
def trigger_media_ingestion(
    request: IngestRequest,
    background_tasks: BackgroundTasks,
):
    """Triggers on-demand media stream resolution, quality selection, instant HLS streaming, and CDN upload."""
    task = _service_instance.create_task(
        tmdb_id=request.tmdb_id,
        media_type=request.media_type,
        requested_quality=request.quality,
        season=request.season,
        episode=request.episode,
        runtime_minutes=request.runtime_minutes,
        synopsis=request.synopsis,
        characters=request.characters,
        title=request.title,
        imdb_id=request.imdb_id,
    )
    if task.status == IngestStatus.PENDING:
        background_tasks.add_task(_service_instance.process_task, task.task_id)

    return IngestResponse(
        task_id=task.task_id,
        status=task.status,
        requested_quality=task.requested_quality,
        stream_url=task.stream_url,
        result_url=task.result_url,
        subtitles=task.subtitles,
        available_qualities=task.available_qualities,
        resolved_quality=task.resolved_quality,
        cdn_subtitles=task.cdn_subtitles,
        message=f"Media ingestion queued in background (Target quality: {task.requested_quality})"
        if task.status == IngestStatus.PENDING
        else f"Task already {task.status.value}",
    )


@router.get("/status/{task_id}", response_model=TaskStatusResponse, dependencies=[Depends(verify_secret_token)])
def get_ingest_task_status(task_id: str):
    """Polls the live progress, instant stream URL, and result of an ingestion job."""
    task = _service_instance.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Ingest task not found")

    return TaskStatusResponse(
        task_id=task.task_id,
        tmdb_id=task.tmdb_id,
        media_type=task.media_type,
        season=task.season,
        episode=task.episode,
        requested_quality=task.requested_quality,
        resolved_quality=task.resolved_quality,
        title=task.title,
        status=task.status,
        progress_pct=task.progress_pct,
        message=task.message,
        stream_url=task.stream_url,
        result_url=task.result_url,
        subtitles=task.subtitles,
        available_qualities=task.available_qualities,
        cdn_subtitles=task.cdn_subtitles,
        cache_failed=task.cache_failed,
    )


@router.get("/tasks", response_model=list[TaskSummary], dependencies=[Depends(verify_secret_token)])
def list_ingest_tasks(limit: int = Query(50, ge=1, le=200)):
    """Recent tasks, newest first (admin operations view)."""
    return [
        TaskSummary(
            task_id=t.task_id,
            tmdb_id=t.tmdb_id,
            media_type=t.media_type,
            season=t.season,
            episode=t.episode,
            title=t.title,
            requested_quality=t.requested_quality,
            resolved_quality=t.resolved_quality,
            status=t.status,
            message=t.message,
            result_url=t.result_url,
            cache_failed=t.cache_failed,
            created_at=t.created_at.isoformat(),
            updated_at=t.updated_at.isoformat(),
        )
        for t in _repository.list_all(limit)
    ]


@router.post("/tasks/{task_id}/translate", dependencies=[Depends(verify_secret_token)])
def translate_task_subtitles(task_id: str, background_tasks: BackgroundTasks):
    """Adds a Sinhala subtitle track to a finished task (backfill, or retry after a failed translation)."""
    task = _service_instance.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Ingest task not found")
    if not _translator.enabled:
        raise HTTPException(status_code=503, detail="Translation is not configured (OPENROUTER_API_KEY)")
    if not task.result_url:
        raise HTTPException(status_code=409, detail="The task has not finished caching yet")
    background_tasks.add_task(_service_instance.translate_existing, task_id)
    return {"queued": True}


@router.get("/tasks/{task_id}/events", dependencies=[Depends(verify_secret_token)])
def get_task_events(task_id: str):
    """Step-by-step pipeline events of one task (admin flow view)."""
    if not _service_instance.get_task(task_id):
        raise HTTPException(status_code=404, detail="Ingest task not found")
    return _repository.list_events(task_id)


@router.get("/pipeline/summary", dependencies=[Depends(verify_secret_token)])
def get_pipeline_summary(hours: int = Query(24, ge=1, le=168)):
    """Per-step outcome counts over a window, for the overview graph."""
    return _repository.step_summary(hours)


# ==============================================================================
# HLS Instant Streaming Proxy Endpoints
# ==============================================================================


@router.get("/stream/{task_id}/master.m3u8", dependencies=[Depends(verify_secret_token)])
def get_proxy_master_playlist(task_id: str):
    """Proxies and rewrites upstream master HLS playlist for instant streaming."""
    task = _service_instance.get_task(task_id)
    if not task or (not task.upstream_stream_url and not task.variants):
        raise HTTPException(status_code=404, detail="Stream not ready")

    proxy_base = f"/api/v1/media/stream/{task_id}"
    rewritten = _hls_proxy.rewrite_master_playlist(task, proxy_base)
    if not rewritten:
        raise HTTPException(status_code=502, detail="Failed to fetch master stream playlist")

    return Response(
        content=rewritten,
        media_type="application/vnd.apple.mpegurl",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        },
    )


@router.get("/stream/{task_id}/variant.m3u8", dependencies=[Depends(verify_secret_token)])
def get_proxy_variant_playlist(
    task_id: str,
    url: Optional[str] = Query(None),
    sig: Optional[str] = Query(None),
    quality: Optional[str] = Query(None),
):
    """Proxies and rewrites upstream variant quality HLS playlist."""
    task = _service_instance.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Stream task not found")

    variant_url = url
    if variant_url and not _hls_proxy.verify(task_id, variant_url, sig):
        raise HTTPException(status_code=403, detail="Invalid playlist signature")
    if not variant_url and quality and task.variants:
        variant_url = task.variants.get(quality)
    if not variant_url:
        variant_url = task.upstream_stream_url

    if not variant_url:
        raise HTTPException(status_code=404, detail="Variant playlist URL not found")

    proxy_base = f"/api/v1/media/stream/{task_id}"
    rewritten = _hls_proxy.rewrite_variant_playlist(variant_url, task, proxy_base)
    if not rewritten:
        raise HTTPException(status_code=502, detail="Failed to fetch variant stream playlist")

    return Response(
        content=rewritten,
        media_type="application/vnd.apple.mpegurl",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        },
    )


@router.api_route("/stream/{task_id}/segment", methods=["GET", "HEAD"], dependencies=[Depends(verify_secret_token)])
def get_proxy_stream_segment(
    task_id: str,
    url: str = Query(...),
    sig: Optional[str] = Query(None),
    range_header: Optional[str] = Header(None, alias="Range"),
):
    """Proxies media chunk/segment from upstream CDN through engine session."""
    task = _service_instance.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Stream task not found")

    if not _hls_proxy.verify(task_id, url, sig):
        raise HTTPException(status_code=403, detail="Invalid segment signature")

    try:
        status_code, headers, content = _hls_proxy.fetch_segment(url, task, range_header=range_header)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream segment fetch failed: {e}")
    ct = headers.get("Content-Type", "")
    if not ct or ct.startswith("text/"):
        ct = "video/mp2t"

    return Response(
        content=content,
        status_code=status_code,
        media_type=ct,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Accept-Ranges": "bytes",
        },
    )


# ==============================================================================
# Subtitle Delivery Endpoint
# ==============================================================================


@router.get("/subtitles/{sub_id}.vtt", dependencies=[Depends(verify_secret_token)])
def get_subtitle_track(sub_id: str):
    """Delivers converted WebVTT subtitle track."""
    vtt = _subtitle_service.get_vtt(sub_id)
    if not vtt:
        raise HTTPException(status_code=404, detail="Subtitle track not found")

    return Response(
        content=vtt,
        media_type="text/vtt; charset=utf-8",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=86400",
        },
    )
