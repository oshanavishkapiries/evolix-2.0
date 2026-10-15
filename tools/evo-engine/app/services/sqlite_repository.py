import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from app.interfaces.repository import ITaskRepository
from app.domain.models import IngestTask, IngestStatus, MediaType


class SQLiteTaskRepository(ITaskRepository):
    """SQLite implementation of ITaskRepository."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS ingest_tasks (
                    task_id TEXT PRIMARY KEY,
                    tmdb_id INTEGER NOT NULL,
                    media_type TEXT NOT NULL,
                    requested_quality TEXT NOT NULL DEFAULT '1080p',
                    resolved_quality TEXT,
                    title TEXT,
                    status TEXT NOT NULL,
                    progress_pct INTEGER NOT NULL DEFAULT 0,
                    message TEXT NOT NULL,
                    result_url TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            # Safe schema migration for new columns
            for col in [
                ("requested_quality", "TEXT NOT NULL DEFAULT '1080p'"),
                ("resolved_quality", "TEXT"),
                ("title", "TEXT"),
            ]:
                try:
                    conn.execute(f"ALTER TABLE ingest_tasks ADD COLUMN {col[0]} {col[1]};")
                except sqlite3.OperationalError:
                    pass  # column already exists

            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_tmdb_media ON ingest_tasks(tmdb_id, media_type);
                """
            )
            conn.commit()

    def save(self, task: IngestTask) -> None:
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO ingest_tasks (
                    task_id, tmdb_id, media_type, requested_quality, resolved_quality,
                    title, status, progress_pct, message, result_url, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    requested_quality=excluded.requested_quality,
                    resolved_quality=excluded.resolved_quality,
                    title=excluded.title,
                    status=excluded.status,
                    progress_pct=excluded.progress_pct,
                    message=excluded.message,
                    result_url=excluded.result_url,
                    updated_at=excluded.updated_at;
                """,
                (
                    task.task_id,
                    task.tmdb_id,
                    task.media_type.value,
                    task.requested_quality,
                    task.resolved_quality,
                    task.title,
                    task.status.value,
                    task.progress_pct,
                    task.message,
                    task.result_url,
                    task.created_at.isoformat(),
                    task.updated_at.isoformat(),
                ),
            )
            conn.commit()

    def _row_to_task(self, row: sqlite3.Row) -> IngestTask:
        return IngestTask(
            task_id=row["task_id"],
            tmdb_id=row["tmdb_id"],
            media_type=MediaType(row["media_type"]),
            requested_quality=row["requested_quality"] if "requested_quality" in row.keys() else "1080p",
            resolved_quality=row["resolved_quality"] if "resolved_quality" in row.keys() else None,
            title=row["title"] if "title" in row.keys() else None,
            status=IngestStatus(row["status"]),
            progress_pct=row["progress_pct"],
            message=row["message"],
            result_url=row["result_url"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    def get_by_id(self, task_id: str) -> Optional[IngestTask]:
        with self._get_connection() as conn:
            cur = conn.execute("SELECT * FROM ingest_tasks WHERE task_id = ?", (task_id,))
            row = cur.fetchone()
            return self._row_to_task(row) if row else None

    def get_by_tmdb_id(self, tmdb_id: int, media_type: str = "movie", quality: Optional[str] = None) -> Optional[IngestTask]:
        with self._get_connection() as conn:
            if quality:
                cur = conn.execute(
                    "SELECT * FROM ingest_tasks WHERE tmdb_id = ? AND media_type = ? AND (requested_quality = ? OR resolved_quality = ?) ORDER BY created_at DESC LIMIT 1",
                    (tmdb_id, media_type, quality, quality),
                )
            else:
                cur = conn.execute(
                    "SELECT * FROM ingest_tasks WHERE tmdb_id = ? AND media_type = ? ORDER BY created_at DESC LIMIT 1",
                    (tmdb_id, media_type),
                )
            row = cur.fetchone()
            return self._row_to_task(row) if row else None

    def list_all(self, limit: int = 50) -> List[IngestTask]:
        with self._get_connection() as conn:
            cur = conn.execute(
                "SELECT * FROM ingest_tasks ORDER BY created_at DESC LIMIT ?",
                (limit,),
            )
            return [self._row_to_task(r) for r in cur.fetchall()]
