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
                    season INTEGER,
                    episode INTEGER,
                    imdb_id TEXT,
                    requested_quality TEXT NOT NULL DEFAULT '1080p',
                    resolved_quality TEXT,
                    title TEXT,
                    status TEXT NOT NULL,
                    progress_pct INTEGER NOT NULL DEFAULT 0,
                    message TEXT NOT NULL,
                    stream_url TEXT,
                    result_url TEXT,
                    subtitles TEXT DEFAULT '[]',
                    upstream_stream_url TEXT,
                    upstream_headers TEXT DEFAULT '{}',
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
                ("season", "INTEGER"),
                ("episode", "INTEGER"),
                ("imdb_id", "TEXT"),
                ("stream_url", "TEXT"),
                ("subtitles", "TEXT DEFAULT '[]'"),
                ("upstream_stream_url", "TEXT"),
                ("upstream_headers", "TEXT DEFAULT '{}'"),
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
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_tmdb_media_se ON ingest_tasks(tmdb_id, media_type, season, episode);
                """
            )
            conn.commit()

    def save(self, task: IngestTask) -> None:
        import json
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO ingest_tasks (
                    task_id, tmdb_id, media_type, season, episode, imdb_id,
                    requested_quality, resolved_quality, title, status, progress_pct,
                    message, stream_url, result_url, subtitles, upstream_stream_url,
                    upstream_headers, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    season=excluded.season,
                    episode=excluded.episode,
                    imdb_id=excluded.imdb_id,
                    requested_quality=excluded.requested_quality,
                    resolved_quality=excluded.resolved_quality,
                    title=excluded.title,
                    status=excluded.status,
                    progress_pct=excluded.progress_pct,
                    message=excluded.message,
                    stream_url=excluded.stream_url,
                    result_url=excluded.result_url,
                    subtitles=excluded.subtitles,
                    upstream_stream_url=excluded.upstream_stream_url,
                    upstream_headers=excluded.upstream_headers,
                    updated_at=excluded.updated_at;
                """,
                (
                    task.task_id,
                    task.tmdb_id,
                    task.media_type.value,
                    task.season,
                    task.episode,
                    task.imdb_id,
                    task.requested_quality,
                    task.resolved_quality,
                    task.title,
                    task.status.value,
                    task.progress_pct,
                    task.message,
                    task.stream_url,
                    task.result_url,
                    json.dumps(task.subtitles),
                    task.upstream_stream_url,
                    json.dumps(task.upstream_headers),
                    task.created_at.isoformat(),
                    task.updated_at.isoformat(),
                ),
            )
            conn.commit()

    def _row_to_task(self, row: sqlite3.Row) -> IngestTask:
        import json
        keys = row.keys()
        subs = []
        if "subtitles" in keys and row["subtitles"]:
            try:
                subs = json.loads(row["subtitles"])
            except Exception:
                subs = []

        up_headers = {}
        if "upstream_headers" in keys and row["upstream_headers"]:
            try:
                up_headers = json.loads(row["upstream_headers"])
            except Exception:
                up_headers = {}

        return IngestTask(
            task_id=row["task_id"],
            tmdb_id=row["tmdb_id"],
            media_type=MediaType(row["media_type"]),
            season=row["season"] if "season" in keys else None,
            episode=row["episode"] if "episode" in keys else None,
            imdb_id=row["imdb_id"] if "imdb_id" in keys else None,
            requested_quality=row["requested_quality"] if "requested_quality" in keys else "1080p",
            resolved_quality=row["resolved_quality"] if "resolved_quality" in keys else None,
            title=row["title"] if "title" in keys else None,
            status=IngestStatus(row["status"]),
            progress_pct=row["progress_pct"],
            message=row["message"],
            stream_url=row["stream_url"] if "stream_url" in keys else None,
            result_url=row["result_url"] if "result_url" in keys else None,
            subtitles=subs,
            upstream_stream_url=row["upstream_stream_url"] if "upstream_stream_url" in keys else None,
            upstream_headers=up_headers,
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    def get_by_id(self, task_id: str) -> Optional[IngestTask]:
        with self._get_connection() as conn:
            cur = conn.execute("SELECT * FROM ingest_tasks WHERE task_id = ?", (task_id,))
            row = cur.fetchone()
            return self._row_to_task(row) if row else None

    def get_by_tmdb_id(
        self,
        tmdb_id: int,
        media_type: str = "movie",
        quality: Optional[str] = None,
        season: Optional[int] = None,
        episode: Optional[int] = None,
    ) -> Optional[IngestTask]:
        with self._get_connection() as conn:
            conditions = ["tmdb_id = ?", "media_type = ?"]
            params: list = [tmdb_id, media_type]

            if season is not None:
                conditions.append("season = ?")
                params.append(season)
            if episode is not None:
                conditions.append("episode = ?")
                params.append(episode)
            if quality:
                conditions.append("(requested_quality = ? OR resolved_quality = ?)")
                params.extend([quality, quality])

            where_clause = " AND ".join(conditions)
            query = f"SELECT * FROM ingest_tasks WHERE {where_clause} ORDER BY created_at DESC LIMIT 1"
            cur = conn.execute(query, tuple(params))
            row = cur.fetchone()
            return self._row_to_task(row) if row else None

    def list_all(self, limit: int = 50) -> List[IngestTask]:
        with self._get_connection() as conn:
            cur = conn.execute(
                "SELECT * FROM ingest_tasks ORDER BY created_at DESC LIMIT ?",
                (limit,),
            )
            return [self._row_to_task(r) for r in cur.fetchall()]
