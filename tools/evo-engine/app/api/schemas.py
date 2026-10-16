from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from app.domain.models import IngestStatus, MediaType


class IngestRequest(BaseModel):
    tmdb_id: int = Field(..., description="The TMDB ID of the movie or show", example=1148365)
    media_type: MediaType = Field(default=MediaType.MOVIE, description="Type: movie or tv")
    quality: str = Field(default="720p", pattern=r"^\d{3,4}p$", description="Desired quality: 1080p, 720p, 480p, etc. Automatically falls back if unavailable")
    season: Optional[int] = Field(default=None, ge=0, le=10000, description="Season number for TV shows", example=1)
    episode: Optional[int] = Field(default=None, ge=0, le=100000, description="Episode number for TV shows", example=1)
    runtime_minutes: Optional[int] = Field(default=None, ge=1, le=1000, description="Expected runtime, used to reject truncated downloads")
    synopsis: Optional[str] = Field(default=None, max_length=1500, description="Plot summary, context for the Sinhala subtitle translation")
    characters: List[str] = Field(default_factory=list, max_length=20, description="Character names, context for the Sinhala subtitle translation")


class IngestResponse(BaseModel):
    task_id: str
    status: IngestStatus
    requested_quality: str
    message: str
    stream_url: Optional[str] = None
    result_url: Optional[str] = None
    subtitles: Optional[List[Dict[str, Any]]] = None
    available_qualities: Optional[List[str]] = None
    resolved_quality: Optional[str] = None
    cdn_subtitles: Optional[List[Dict[str, Any]]] = None


class TaskStatusResponse(BaseModel):
    task_id: str
    tmdb_id: int
    media_type: MediaType
    season: Optional[int] = None
    episode: Optional[int] = None
    requested_quality: str
    resolved_quality: Optional[str] = None
    title: Optional[str] = None
    status: IngestStatus
    progress_pct: int
    message: str
    stream_url: Optional[str] = None
    result_url: Optional[str] = None
    subtitles: Optional[List[Dict[str, Any]]] = None
    available_qualities: Optional[List[str]] = None
    cdn_subtitles: Optional[List[Dict[str, Any]]] = None
    cache_failed: bool = False


class TaskSummary(BaseModel):
    task_id: str
    tmdb_id: int
    media_type: MediaType
    season: Optional[int] = None
    episode: Optional[int] = None
    title: Optional[str] = None
    requested_quality: str
    resolved_quality: Optional[str] = None
    status: IngestStatus
    message: str
    result_url: Optional[str] = None
    cache_failed: bool = False
    created_at: str
    updated_at: str
