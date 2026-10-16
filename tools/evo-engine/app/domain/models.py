from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List
from datetime import datetime


class IngestStatus(str, Enum):
    PENDING = "PENDING"
    EXTRACTING = "EXTRACTING"
    STREAMING = "STREAMING"
    DOWNLOADING = "DOWNLOADING"
    UPLOADING = "UPLOADING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


# Pipeline steps in flow order. The admin graph and the engine share these ids.
STEPS = [
    "request",
    "extract",
    "resolve",
    "subtitles",
    "stream",
    "cdn_check",
    "download",
    "verify",
    "upload",
    "subtitle_sync",
    "webhook",
]


class MediaType(str, Enum):
    MOVIE = "movie"
    TV = "tv"


@dataclass
class StreamSource:
    url: str
    quality: str = "1080p"
    headers: dict = field(default_factory=dict)
    title: Optional[str] = None
    imdb_id: Optional[str] = None


@dataclass
class UploadResult:
    storage_provider: str
    file_id: str
    direct_url: str
    size_bytes: int


@dataclass
class IngestTask:
    task_id: str
    media_type: MediaType
    tmdb_id: int
    requested_quality: str = "720p"
    resolved_quality: Optional[str] = None
    title: Optional[str] = None
    season: Optional[int] = None
    episode: Optional[int] = None
    imdb_id: Optional[str] = None
    status: IngestStatus = IngestStatus.PENDING
    progress_pct: int = 0
    message: str = "Initialized"
    stream_url: Optional[str] = None
    result_url: Optional[str] = None
    subtitles: List[dict] = field(default_factory=list)
    available_qualities: List[str] = field(default_factory=list)
    variants: dict = field(default_factory=dict)
    upstream_stream_url: Optional[str] = None
    upstream_headers: dict = field(default_factory=dict)
    # Subtitle tracks re-hosted on the CDN: [{"language", "label", "url"}].
    cdn_subtitles: List[dict] = field(default_factory=list)
    # Expected length, used to reject truncated downloads before they are published.
    runtime_minutes: Optional[int] = None
    # Streaming works but the CDN copy failed or was interrupted (a new request retries the cache).
    cache_failed: bool = False
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
