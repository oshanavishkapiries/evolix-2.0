from pydantic import BaseModel, Field
from typing import Optional
from app.domain.models import IngestStatus, MediaType


class IngestRequest(BaseModel):
    tmdb_id: int = Field(..., description="The TMDB ID of the movie or show", example=1148365)
    media_type: MediaType = Field(default=MediaType.MOVIE, description="Type: movie or tv")
    quality: str = Field(default="1080p", description="Desired quality: 1080p, 720p, 480p, etc. Automatically falls back if unavailable")


class IngestResponse(BaseModel):
    task_id: str
    status: IngestStatus
    requested_quality: str
    message: str
    result_url: Optional[str] = None


class TaskStatusResponse(BaseModel):
    task_id: str
    tmdb_id: int
    media_type: MediaType
    requested_quality: str
    resolved_quality: Optional[str] = None
    title: Optional[str] = None
    status: IngestStatus
    progress_pct: int
    message: str
    result_url: Optional[str] = None
