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
                ("requested_quality", "TEXT NOT NULL DEFAULT '720p'"),
                ("resolved_quality", "TEXT"),
                ("title", "TEXT"),
                ("season", "INTEGER"),
                ("episode", "INTEGER"),
                ("imdb_id", "TEXT"),
                ("stream_url", "TEXT"),
                ("subtitles", "TEXT DEFAULT '[]'"),
                ("available_qualities", "TEXT DEFAULT '[]'"),
                ("variants", "TEXT DEFAULT '{}'"),
                ("upstream_stream_url", "TEXT"),
                ("upstream_headers", "TEXT DEFAULT '{}'"),
                ("cdn_subtitles", "TEXT DEFAULT '[]'"),
                ("runtime_minutes", "INTEGER"),
                ("cache_failed", "INTEGER NOT NULL DEFAULT 0"),
                ("synopsis", "TEXT"),
                ("characters", "TEXT DEFAULT '[]'"),
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
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS task_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    step TEXT NOT NULL,
                    state TEXT NOT NULL,
                    detail TEXT NOT NULL DEFAULT '',
                    ts TEXT NOT NULL
                );
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS api_usage (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT,
                    model TEXT NOT NULL,
                    cost_usd REAL NOT NULL,
                    tokens INTEGER NOT NULL DEFAULT 0,
                    ts TEXT NOT NULL
                );
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_api_usage_ts ON api_usage(ts);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, id);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_task_events_ts ON task_events(ts);")
            conn.commit()

    def save(self, task: IngestTask) -> None:
        import json
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO ingest_tasks (
                    task_id, tmdb_id, media_type, season, episode, imdb_id,
                    requested_quality, resolved_quality, title, status, progress_pct,
                    message, stream_url, result_url, subtitles, available_qualities,
                    variants, upstream_stream_url, upstream_headers, cdn_subtitles, runtime_minutes,
                    cache_failed, synopsis, characters, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    available_qualities=excluded.available_qualities,
                    variants=excluded.variants,
                    upstream_stream_url=excluded.upstream_stream_url,
                    upstream_headers=excluded.upstream_headers,
                    cdn_subtitles=excluded.cdn_subtitles,
                    runtime_minutes=excluded.runtime_minutes,
                    cache_failed=excluded.cache_failed,
                    synopsis=excluded.synopsis,
                    characters=excluded.characters,
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
                    json.dumps(task.available_qualities),
                    json.dumps(task.variants),
                    task.upstream_stream_url,
                    json.dumps(task.upstream_headers),
                    json.dumps(task.cdn_subtitles),
                    task.runtime_minutes,
                    1 if task.cache_failed else 0,
                    task.synopsis,
                    json.dumps(task.characters),
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

        avail_quals = []
        if "available_qualities" in keys and row["available_qualities"]:
            try:
                avail_quals = json.loads(row["available_qualities"])
            except Exception:
                avail_quals = []

        variants = {}
        if "variants" in keys and row["variants"]:
            try:
                variants = json.loads(row["variants"])
            except Exception:
                variants = {}

        up_headers = {}
        if "upstream_headers" in keys and row["upstream_headers"]:
            try:
                up_headers = json.loads(row["upstream_headers"])
            except Exception:
                up_headers = {}

        cdn_subs = []
        if "cdn_subtitles" in keys and row["cdn_subtitles"]:
            try:
                cdn_subs = json.loads(row["cdn_subtitles"])
            except Exception:
                cdn_subs = []

        characters = []
        if "characters" in keys and row["characters"]:
            try:
                characters = json.loads(row["characters"])
            except Exception:
                characters = []

        return IngestTask(
            task_id=row["task_id"],
            tmdb_id=row["tmdb_id"],
            media_type=MediaType(row["media_type"]),
            season=row["season"] if "season" in keys else None,
            episode=row["episode"] if "episode" in keys else None,
            imdb_id=row["imdb_id"] if "imdb_id" in keys else None,
            requested_quality=row["requested_quality"] if "requested_quality" in keys else "720p",
            resolved_quality=row["resolved_quality"] if "resolved_quality" in keys else None,
            title=row["title"] if "title" in keys else None,
            status=IngestStatus(row["status"]),
            progress_pct=row["progress_pct"],
            message=row["message"],
            stream_url=row["stream_url"] if "stream_url" in keys else None,
            result_url=row["result_url"] if "result_url" in keys else None,
            subtitles=subs,
            available_qualities=avail_quals,
            variants=variants,
            upstream_stream_url=row["upstream_stream_url"] if "upstream_stream_url" in keys else None,
            upstream_headers=up_headers,
            cdn_subtitles=cdn_subs,
            runtime_minutes=row["runtime_minutes"] if "runtime_minutes" in keys else None,
            cache_failed=bool(row["cache_failed"]) if "cache_failed" in keys else False,
            synopsis=row["synopsis"] if "synopsis" in keys else None,
            characters=characters,
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

    def find_completed(
        self,
        tmdb_id: int,
        media_type: str,
        resolved_quality: str,
        season: Optional[int] = None,
        episode: Optional[int] = None,
        exclude_task_id: Optional[str] = None,
    ) -> Optional[IngestTask]:
        with self._get_connection() as conn:
            query = (
                "SELECT * FROM ingest_tasks WHERE tmdb_id = ? AND media_type = ? AND resolved_quality = ? "
                "AND status = 'COMPLETED' AND result_url IS NOT NULL "
                "AND season IS ? AND episode IS ?"
            )
            params: list = [tmdb_id, media_type, resolved_quality, season, episode]
            if exclude_task_id:
                query += " AND task_id != ?"
                params.append(exclude_task_id)
            row = conn.execute(query + " ORDER BY created_at DESC LIMIT 1", tuple(params)).fetchone()
            return self._row_to_task(row) if row else None

    def recover_interrupted(self) -> int:
        now = datetime.utcnow().isoformat()
        with self._get_connection() as conn:
            failed = conn.execute(
                "UPDATE ingest_tasks SET status = 'FAILED', message = 'Interrupted by engine restart', updated_at = ? "
                "WHERE status IN ('PENDING', 'EXTRACTING', 'DOWNLOADING', 'UPLOADING')",
                (now,),
            ).rowcount
            # Streaming keeps working (variants are persisted); only the CDN copy died, so allow a retry.
            streaming = conn.execute(
                "UPDATE ingest_tasks SET cache_failed = 1, message = 'Streaming (caching interrupted by restart)', updated_at = ? "
                "WHERE status = 'STREAMING' AND result_url IS NULL",
                (now,),
            ).rowcount
            conn.commit()
        return failed + streaming

    def add_event(self, task_id: str, step: str, state: str, detail: str = "") -> None:
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO task_events (task_id, step, state, detail, ts) VALUES (?, ?, ?, ?, ?)",
                (task_id, step, state, detail[:500], datetime.utcnow().isoformat()),
            )
            conn.commit()

    def list_events(self, task_id: str) -> List[dict]:
        with self._get_connection() as conn:
            cur = conn.execute(
                "SELECT step, state, detail, ts FROM task_events WHERE task_id = ? ORDER BY id",
                (task_id,),
            )
            return [dict(r) for r in cur.fetchall()]

    def step_summary(self, since_hours: int = 24) -> dict:
        from datetime import timedelta

        since = (datetime.utcnow() - timedelta(hours=since_hours)).isoformat()
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT task_id, step, state FROM task_events WHERE ts >= ? ORDER BY id", (since,)
            ).fetchall()
            running_tasks = conn.execute(
                "SELECT COUNT(*) FROM ingest_tasks WHERE status IN ('PENDING', 'EXTRACTING', 'DOWNLOADING', 'UPLOADING')"
            ).fetchone()[0]
        # A step's outcome for a task is its latest event.
        latest: dict = {}
        for r in rows:
            latest[(r["task_id"], r["step"])] = r["state"]
        steps: dict = {}
        for (_, step), state in latest.items():
            bucket = steps.setdefault(step, {"ok": 0, "failed": 0, "running": 0, "skipped": 0})
            bucket[state] = bucket.get(state, 0) + 1
        return {"window_hours": since_hours, "steps": steps, "tasks_in_flight": running_tasks}

    def add_usage(self, task_id: Optional[str], model: str, cost_usd: float, tokens: int) -> None:
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO api_usage (task_id, model, cost_usd, tokens, ts) VALUES (?, ?, ?, ?, ?)",
                (task_id, model, cost_usd, tokens, datetime.utcnow().isoformat()),
            )
            conn.commit()

    def usage_today(self) -> float:
        start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        with self._get_connection() as conn:
            row = conn.execute("SELECT COALESCE(SUM(cost_usd), 0) FROM api_usage WHERE ts >= ?", (start,)).fetchone()
        return float(row[0])
