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
    def get_by_tmdb_id(
        self,
        tmdb_id: int,
        media_type: str,
        quality: Optional[str] = None,
        season: Optional[int] = None,
        episode: Optional[int] = None,
    ) -> Optional[IngestTask]:
        """Finds task by TMDB ID, media type, optional quality, and optional season/episode."""
        pass

    @abstractmethod
    def list_all(self, limit: int = 50) -> List[IngestTask]:
        """Lists recent tasks."""
        pass

    @abstractmethod
    def find_completed(
        self,
        tmdb_id: int,
        media_type: str,
        resolved_quality: str,
        season: Optional[int] = None,
        episode: Optional[int] = None,
        exclude_task_id: Optional[str] = None,
    ) -> Optional[IngestTask]:
        """Finds a COMPLETED (CDN-cached) task for the same media at the same resolved quality."""
        pass

    @abstractmethod
    def recover_interrupted(self) -> int:
        """Marks tasks left mid-flight by a process restart as failed/interrupted; returns how many."""
        pass

    @abstractmethod
    def add_event(self, task_id: str, step: str, state: str, detail: str = "") -> None:
        """Appends a pipeline step event (state: running | ok | failed | skipped)."""
        pass

    @abstractmethod
    def list_events(self, task_id: str) -> List[dict]:
        """Step events of a task, oldest first."""
        pass

    @abstractmethod
    def step_summary(self, since_hours: int = 24) -> dict:
        """Per-step counts of tasks by latest state within the window, plus tasks currently running."""
        pass
