from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from app.domain.models import IngestStatus, MediaType


class IngestRequest(BaseModel):
    tmdb_id: int = Field(..., description="The TMDB ID of the movie or show", example=1148365)
    media_type: MediaType = Field(default=MediaType.MOVIE, description="Type: movie or tv")
    quality: str = Field(default="720p", description="Desired quality: 1080p, 720p, 480p, etc. Automatically falls back if unavailable")
    season: Optional[int] = Field(default=None, description="Season number for TV shows", example=1)
    episode: Optional[int] = Field(default=None, description="Episode number for TV shows", example=1)


class IngestResponse(BaseModel):
    task_id: str
    status: IngestStatus
    requested_quality: str
    message: str
    stream_url: Optional[str] = None
    result_url: Optional[str] = None
    subtitles: Optional[List[Dict[str, Any]]] = None
    available_qualities: Optional[List[str]] = None


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
