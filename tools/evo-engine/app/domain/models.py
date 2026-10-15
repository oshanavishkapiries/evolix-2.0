from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List
from datetime import datetime


class IngestStatus(str, Enum):
    PENDING = "PENDING"
    EXTRACTING = "EXTRACTING"
    DOWNLOADING = "DOWNLOADING"
    UPLOADING = "UPLOADING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class MediaType(str, Enum):
    MOVIE = "movie"
    TV = "tv"


@dataclass
class StreamSource:
    url: str
    quality: str = "1080p"
    headers: dict = field(default_factory=dict)
    title: Optional[str] = None


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
    requested_quality: str = "1080p"
    resolved_quality: Optional[str] = None
    title: Optional[str] = None
    status: IngestStatus = IngestStatus.PENDING
    progress_pct: int = 0
    message: str = "Initialized"
    result_url: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
