from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends, Header, Response, Query
from typing import Optional
from pydantic import BaseModel, Field
import base64
import shutil
import tempfile
from pathlib import Path
import os
import threading
from app.api.schemas import IngestRequest, IngestResponse, SinhalaSubtitleRequest, TaskStatusResponse, TaskSummary
from app.domain.models import IngestStatus, MediaType
from app.services.ingest_service import IngestService
from app.services.cinesrc_extractor import CineSrcStreamExtractor
from app.services.composite_extractor import CompositeStreamExtractor
from app.services.extraction_cache import CachingExtractor
from app.services.stream_validator import validate_streams
from app.services.ythd_extractor import YtHdStreamExtractor
from app.services.ffmpeg_downloader import FFmpegStreamDownloader
from app.services.pixeldrain_storage import PixeldrainStorageProvider
from app.services.sqlite_repository import SQLiteTaskRepository
from app.services.subtitle_service import SubtitleService
from app.services.hls_proxy import HlsProxyService
from app.services.translation_service import SinhalaTranslator
from app.core.config import settings
from app.core import metrics, runtime_config

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
_PROVIDER_KEYS = {id(_cinesrc_extractor): "cinesrc", id(_ythd_extractor): "ythd"}


def _by_admin_order(extractors):
    """The providers in the order the admin chose (setting EXTRACTOR_ORDER); one the setting forgot goes last."""
    wanted = [k.strip() for k in str(settings.EXTRACTOR_ORDER).split(",")]
    rank = lambda e: wanted.index(_PROVIDER_KEYS[id(e)]) if _PROVIDER_KEYS[id(e)] in wanted else len(wanted)
    return sorted(extractors, key=rank)


_composite = CompositeStreamExtractor([_cinesrc_extractor, _ythd_extractor], validator=validate_streams, order=_by_admin_order)
# Other qualities of a title reuse a recent extraction instead of launching the providers again.
_extractor = CachingExtractor(_composite, validator=validate_streams)
metrics.set_sink(_repository.add_metric)
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


_stream_cache: dict = {}


def _stream_task(task_id: str):
    """Task lookup for the hot streaming path (a playlist/segment request per few seconds per viewer): cached for 10s."""
    import time
    now = time.monotonic()
    hit = _stream_cache.get(task_id)
    if hit and now - hit[0] < 10:
        return hit[1]
    task = _service_instance.get_task(task_id)
    if len(_stream_cache) > 2000:
        _stream_cache.clear()
    if task:
        _stream_cache[task_id] = (now, task)
    return task


@router.post("/ingest", response_model=IngestResponse, dependencies=[Depends(verify_secret_token)])
def trigger_media_ingestion(
    request: IngestRequest,
    background_tasks: BackgroundTasks,
):
    """Triggers on-demand media stream resolution, quality selection, instant HLS streaming, and CDN upload."""
    task, created = _service_instance.create_or_join(
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
    if task.status == IngestStatus.PENDING and not _service_instance.enqueue(task.task_id):
        # A refused request leaves no trace: a FAILED row per "busy" answer would pile up as every viewer retries.
        # A task that already existed was joined, not created: it is already waiting, so it keeps its place.
        if created:
            _repository.delete_task(task.task_id)
            raise HTTPException(status_code=503, detail="Engine is busy, try again shortly", headers={"Retry-After": "30"})

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


@router.post("/subtitles/si", dependencies=[Depends(verify_secret_token)])
def request_sinhala_subtitles(request: SinhalaSubtitleRequest):
    """Starts (or joins) the Sinhala translation of a title/episode, identified by TMDB/IMDb ids alone.

    Returns {state: running | done | failed | unavailable, progress?, subtitle?}; poll GET /subtitles/si for it.
    """
    return _service_instance.request_sinhala(
        tmdb_id=request.tmdb_id,
        media_type=request.media_type,
        season=request.season,
        episode=request.episode,
        title=request.title,
        imdb_id=request.imdb_id,
        synopsis=request.synopsis,
        characters=request.characters,
        source_track_id=request.source_track_id,
        source_url=request.source_url,
    )


@router.get("/subtitles/si", dependencies=[Depends(verify_secret_token)])
def get_sinhala_subtitles_status(
    tmdb_id: int = Query(..., gt=0),
    media_type: MediaType = Query(MediaType.MOVIE),
    season: Optional[int] = Query(None, ge=0, le=10000),
    episode: Optional[int] = Query(None, ge=0, le=100000),
    source_track_id: Optional[str] = Query(None, pattern=r"^[0-9a-f-]{36}$"),
):
    """Progress of the Sinhala translation for a title (state "none" when nobody asked for it yet)."""
    return _service_instance.sinhala_status(_service_instance.find_sinhala_job(tmdb_id, media_type, season, episode, source_track_id))


@router.get("/subtitles/search", dependencies=[Depends(verify_secret_token)])
def search_subtitles(
    imdb_id: str = Query(..., pattern=r"^tt\d{5,10}$"),
    lang: str = Query("en", pattern=r"^(en|es|fr|de|pt|it|ar|ru|si|hi)$"),
    season: Optional[int] = Query(None, ge=0, le=10000),
    episode: Optional[int] = Query(None, ge=0, le=100000),
):
    return _subtitle_service.search_candidates(imdb_id, lang, season, episode)


class SubtitleSelectRequest(BaseModel):
    ref: str = Field(pattern=r"^sub_\d+_[a-z]{2}_\d+$")


class SubtitleUploadRequest(BaseModel):
    file_name: str = Field(max_length=200)
    content_base64: str = Field(max_length=2796204)
    episode: bool = False
    runtime_minutes: Optional[int] = Field(None, ge=1, le=1000)


_publish_locks: dict[str, threading.Lock] = {}
_publish_guard = threading.Lock()


def _publish_subtitle(sub_id: str) -> dict:
    with _publish_guard:
        lock = _publish_locks.setdefault(sub_id, threading.Lock())
    with lock:
        return _publish_subtitle_once(sub_id)


def _publish_subtitle_once(sub_id: str) -> dict:
    entry = _subtitle_service._meta_cache.get(sub_id, {})
    if isinstance(entry, dict) and entry.get("cdn_url"):
        return {"id": sub_id, "url": entry["cdn_url"], "originRef": _subtitle_service.origin_ref(sub_id), "release": entry.get("resolved_release")}
    folder = Path(tempfile.mkdtemp(dir=settings.TEMP_DIR))
    try:
        path = folder / f"{sub_id}.vtt"
        vtt = _subtitle_service.get_vtt(sub_id)
        if not vtt:
            raise HTTPException(422, _subtitle_service.get_last_error(sub_id) or "Subtitle download failed")
        path.write_text(vtt, encoding="utf-8")
        uploaded = _storage.upload_file(path)
        entry = _subtitle_service._meta_cache.get(sub_id, {})
        if not isinstance(entry, dict):
            entry = {"dl_link": entry}
        entry["cdn_url"] = uploaded.direct_url
        _subtitle_service._meta_cache[sub_id] = entry
        _subtitle_service._save_meta()
        return {"id": sub_id, "url": uploaded.direct_url, "originRef": _subtitle_service.origin_ref(sub_id), "release": entry.get("resolved_release")}
    finally:
        shutil.rmtree(folder, ignore_errors=True)


@router.post("/subtitles/select", dependencies=[Depends(verify_secret_token)])
def select_subtitle(request: SubtitleSelectRequest):
    return _publish_subtitle(request.ref)


@router.post("/subtitles/upload", dependencies=[Depends(verify_secret_token)])
def upload_subtitle(request: SubtitleUploadRequest):
    if Path(request.file_name).suffix.lower() not in (".srt", ".vtt"):
        raise HTTPException(422, "Choose an .srt or .vtt subtitle")
    try:
        raw = base64.b64decode(request.content_base64, validate=True)
        sub_id = _subtitle_service.store_upload(raw, request.episode, request.runtime_minutes)
    except (ValueError, base64.binascii.Error) as e:
        raise HTTPException(422, str(e))
    return _publish_subtitle(sub_id)


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


@router.get("/pipeline/journeys", dependencies=[Depends(verify_secret_token)])
def get_pipeline_journeys(hours: int = Query(24, ge=1, le=168)):
    """Tasks of a window grouped per title/episode: did the viewer finally get to watch, after how many tries."""
    return _repository.journeys(hours)


@router.get("/metrics", dependencies=[Depends(verify_secret_token)])
def get_extraction_metrics(hours: int = Query(24, ge=1, le=168)):
    """Median / p95 duration, peak RAM and CPU per provider over a window (the admin pipeline view)."""
    return _repository.metric_summary(hours)


@router.get("/providers", dependencies=[Depends(verify_secret_token)])
def get_providers():
    """Health of each stream provider: healthy, cooling down until a time, or waiting for a trial."""
    return _composite.health.snapshot(_composite.provider_names)


@router.post("/providers/{name}/reset", dependencies=[Depends(verify_secret_token)])
def reset_provider(name: str):
    if name not in _composite.provider_names:
        raise HTTPException(status_code=404, detail="Unknown provider")
    _composite.health.reset(name)
    return _composite.health.snapshot(_composite.provider_names)


# ==============================================================================
# HLS Instant Streaming Proxy Endpoints
# ==============================================================================


@router.get("/stream/{task_id}/master.m3u8", dependencies=[Depends(verify_secret_token)])
async def get_proxy_master_playlist(task_id: str):
    """Proxies and rewrites upstream master HLS playlist for instant streaming."""
    task = _stream_task(task_id)
    if not task or (not task.upstream_stream_url and not task.variants):
        raise HTTPException(status_code=404, detail="Stream not ready")

    proxy_base = f"/api/v1/media/stream/{task_id}"
    rewritten = await _hls_proxy.rewrite_master_playlist(task, proxy_base)
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
async def get_proxy_variant_playlist(
    task_id: str,
    url: Optional[str] = Query(None),
    sig: Optional[str] = Query(None),
    quality: Optional[str] = Query(None),
):
    """Proxies and rewrites upstream variant quality HLS playlist."""
    task = _stream_task(task_id)
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
    rewritten = await _hls_proxy.rewrite_variant_playlist(variant_url, task, proxy_base)
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
async def get_proxy_stream_segment(
    task_id: str,
    url: str = Query(...),
    sig: Optional[str] = Query(None),
    range_header: Optional[str] = Header(None, alias="Range"),
):
    """Proxies media chunk/segment from upstream CDN through engine session."""
    task = _stream_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Stream task not found")

    if not _hls_proxy.verify(task_id, url, sig):
        raise HTTPException(status_code=403, detail="Invalid segment signature")

    try:
        status_code, headers, content = await _hls_proxy.fetch_segment(url, task, range_header=range_header)
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


# ==============================================================================
# Admin controls: runtime config, queue, task actions, CDN files
# ==============================================================================

_AUTH = [Depends(verify_secret_token)]


def load_runtime_config() -> None:
    """Applies admin overrides saved in SQLite (called at startup)."""
    for key, value in _repository.get_config().items():
        if key in runtime_config.BY_KEY:
            runtime_config.apply(key, value)
    _service_instance.apply_config()


@router.get("/config", dependencies=_AUTH)
def get_config():
    return runtime_config.snapshot(_repository.get_config())


@router.put("/config", dependencies=_AUTH)
def update_config(values: dict):
    """Body: {KEY: number, ...}. All values are validated before any is applied."""
    try:
        clean = {k: runtime_config.coerce(k, v) for k, v in values.items()}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    for k, v in clean.items():
        _repository.set_config(k, v)
        runtime_config.apply(k, v)
    _service_instance.apply_config()
    return runtime_config.snapshot(_repository.get_config())


@router.delete("/config/{key}", dependencies=_AUTH)
def reset_config(key: str):
    """Back to the value from .env."""
    if key not in runtime_config.BY_KEY:
        raise HTTPException(status_code=404, detail="Unknown setting")
    _repository.delete_config(key)
    runtime_config.apply(key, None)
    _service_instance.apply_config()
    return runtime_config.snapshot(_repository.get_config())


@router.get("/queue", dependencies=_AUTH)
def queue_status():
    return _service_instance.queue_status()


@router.post("/queue/{action}", dependencies=_AUTH)
def queue_action(action: str):
    if action not in ("pause", "resume"):
        raise HTTPException(status_code=404, detail="Unknown action")
    _service_instance.paused = action == "pause"
    return _service_instance.queue_status()


_IN_FLIGHT = (IngestStatus.PENDING, IngestStatus.EXTRACTING, IngestStatus.DOWNLOADING, IngestStatus.UPLOADING)


def _exit_process() -> None:
    """Ends the process with a non-zero code, so Docker's restart policy (always / unless-stopped / on-failure) brings it back."""
    os._exit(3)


RESTART_DELAY_S = 1.0


@router.post("/restart", dependencies=_AUTH)
def restart_engine(force: bool = Query(False)):
    """Restarts the engine process; the container's restart policy starts it again (`restart: unless-stopped` in
    compose.yaml, and the default in Coolify). Jobs still running are lost, so it is refused while any are unless
    `force=true`. The answer is sent first; the process ends a moment later."""
    running = sum(1 for t in _repository.list_all(500) if t.status in _IN_FLIGHT)
    if running and not force:
        raise HTTPException(status_code=409, detail=f"{running} job(s) are still running. Restarting now would lose them.")
    timer = threading.Timer(RESTART_DELAY_S, _exit_process)
    timer.daemon = True
    timer.start()
    return {"restarting": True, "running": running}


@router.delete("/subtitles/si-cache", dependencies=_AUTH)
def purge_sinhala_cache():
    """Drops the engine's cached Sinhala translations, so every Sinhala request translates again."""
    return {"removed": _subtitle_service.purge_translations()}


@router.post("/tasks/{task_id}/cancel", dependencies=_AUTH)
def cancel_task(task_id: str):
    if not _service_instance.cancel(task_id):
        raise HTTPException(status_code=409, detail="Task not found or already finished")
    return {"cancelled": True}


@router.post("/tasks/{task_id}/retry", dependencies=_AUTH)
def retry_task(task_id: str):
    """Runs a failed / uncached task again as a fresh job with the same title and quality."""
    old = _service_instance.get_task(task_id)
    if not old:
        raise HTTPException(status_code=404, detail="Ingest task not found")
    if old.requested_quality.startswith("sub:si"):
        raise HTTPException(status_code=409, detail="Use the translate action for subtitle jobs")
    if old.status in _IN_FLIGHT:
        raise HTTPException(status_code=409, detail="Task is still running")
    _service_instance._cancelled.discard(task_id)
    task = _service_instance.create_task(
        tmdb_id=old.tmdb_id, media_type=old.media_type, requested_quality=old.requested_quality, season=old.season,
        episode=old.episode, runtime_minutes=old.runtime_minutes, synopsis=old.synopsis, characters=old.characters,
        title=old.title, imdb_id=old.imdb_id,
    )
    if task.status == IngestStatus.PENDING and not _service_instance.enqueue(task.task_id):
        task.status = IngestStatus.FAILED
        task.message = "Engine is busy, try again shortly"
        _repository.save(task)
        raise HTTPException(status_code=503, detail="Engine is busy")
    return {"task_id": task.task_id, "status": task.status}


@router.delete("/tasks/{task_id}", dependencies=_AUTH)
def delete_task(task_id: str):
    task = _service_instance.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Ingest task not found")
    if task.status in _IN_FLIGHT:
        raise HTTPException(status_code=409, detail="Cancel the task first")
    _repository.delete_task(task_id)
    return {"deleted": True}


class CdnUrl(BaseModel):
    url: str


def _pixeldrain_id(url: str) -> str:
    import re
    m = re.fullmatch(r"https://pixeldrain\.com/api/file/([A-Za-z0-9_-]+)", url.strip())
    if not m:
        raise HTTPException(status_code=422, detail="Not a Pixeldrain file URL")
    return m.group(1)


@router.post("/cdn/delete", dependencies=_AUTH)
def delete_cdn_file(body: CdnUrl):
    """Deletes a file from the CDN account and forgets it, so the next play re-caches the title."""
    file_id = _pixeldrain_id(body.url)
    try:
        _storage.delete_file(file_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    _subtitle_service.forget_publication(body.url.strip())
    return {"deleted": True, "tasks_reset": _repository.clear_cdn_url(body.url.strip())}


@router.get("/cdn/files", dependencies=_AUTH)
def list_cdn_files():
    try:
        files = _storage.list_files()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return [
        {"id": f.get("id"), "name": f.get("name"), "size": f.get("size"), "views": f.get("views"), "date_upload": f.get("date_upload"),
         "url": f"https://pixeldrain.com/api/file/{f.get('id')}"}
        for f in files
    ]


class CdnUrls(BaseModel):
    urls: list[str]


class CdnAlbum(BaseModel):
    title: str = ""
    ids: list[str] = []
    add: list[str] = []
    remove: list[str] = []


def _cdn_call(fn, *a):
    try:
        return fn(*a)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/cdn/delete-many", dependencies=_AUTH)
def delete_cdn_files(body: CdnUrls):
    """Batch delete: each file is deleted and forgotten; one failure does not stop the rest."""
    done, failed, reset = [], [], 0
    for url in body.urls[:200]:
        try:
            _storage.delete_file(_pixeldrain_id(url))
            _subtitle_service.forget_publication(url.strip())
            reset += _repository.clear_cdn_url(url.strip())
            done.append(url)
        except Exception as e:
            failed.append({"url": url, "error": e.detail if isinstance(e, HTTPException) else str(e)})
    return {"deleted": done, "failed": failed, "tasks_reset": reset}


@router.get("/cdn/user", dependencies=_AUTH)
def cdn_account():
    return _cdn_call(_storage.user_info)


@router.get("/cdn/albums", dependencies=_AUTH)
def cdn_albums():
    return _cdn_call(_storage.list_albums)


@router.get("/cdn/albums/{list_id}", dependencies=_AUTH)
def cdn_album(list_id: str):
    return _cdn_call(_storage.get_album, list_id)


@router.post("/cdn/albums", dependencies=_AUTH)
def cdn_create_album(body: CdnAlbum):
    if not body.title.strip() or not body.ids:
        raise HTTPException(status_code=422, detail="An album needs a title and at least one file")
    return {"id": _cdn_call(_storage.create_album, body.title.strip(), body.ids)}


@router.put("/cdn/albums/{list_id}", dependencies=_AUTH)
def cdn_update_album(list_id: str, body: CdnAlbum):
    return _cdn_call(_storage.update_album, list_id, body.title.strip() or None, body.add, body.remove)


@router.delete("/cdn/albums/{list_id}", dependencies=_AUTH)
def cdn_delete_album(list_id: str):
    _cdn_call(_storage.delete_album, list_id)
    return {"deleted": True}
