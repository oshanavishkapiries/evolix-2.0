from abc import ABC, abstractmethod
from typing import Optional, List
from app.domain.models import IngestTask


class ITaskRepository(ABC):
    """Abstract Repository interface for storing and retrieving IngestTask entities (Repository Pattern)."""

    @abstractmethod
    def save(self, task: IngestTask) -> None:
        """Creates or updates a task."""
        pass

    @abstractmethod
    def get_by_id(self, task_id: str) -> Optional[IngestTask]:
        """Finds task by its UUID."""
        pass

    @abstractmethod
    def get_by_tmdb_id(self, tmdb_id: int, media_type: str, quality: Optional[str] = None) -> Optional[IngestTask]:
        """Finds task by TMDB ID, media type, and optional quality."""
        pass

    @abstractmethod
    def list_all(self, limit: int = 50) -> List[IngestTask]:
        """Lists recent tasks."""
        pass
