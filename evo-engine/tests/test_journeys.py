import tempfile
import unittest
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

from app.core.config import settings
from app.domain.models import IngestStatus, IngestTask, MediaType
from app.services.sqlite_repository import SQLiteTaskRepository

NOW = datetime.utcnow()


def at(minutes_ago: float, seconds: float = 0) -> datetime:
    return NOW - timedelta(minutes=minutes_ago) + timedelta(seconds=seconds)


class Journeys(unittest.TestCase):
    def setUp(self):
        self.repo = SQLiteTaskRepository(Path(tempfile.mkdtemp(dir=settings.TEMP_DIR)) / "j.sqlite3")

    def task(self, tmdb, started, status, *, season=None, episode=None, quality="720p", stream=False, result=False, subs=None, cache_failed=False, title="T", message="", events=()):
        t = IngestTask(
            task_id=str(uuid.uuid4()), media_type=MediaType.TV if season is not None else MediaType.MOVIE, tmdb_id=tmdb,
            requested_quality=quality, title=title, season=season, episode=episode, status=status, message=message,
            stream_url="/s.m3u8" if stream else None, result_url="https://pixeldrain.com/api/file/x" if result else None,
            cdn_subtitles=subs or [], cache_failed=cache_failed, created_at=started, updated_at=started + timedelta(seconds=30),
        )
        self.repo.save(t)
        with self.repo._get_connection() as conn:
            for step, state, detail, seconds in events:
                conn.execute("INSERT INTO task_events (task_id, step, state, detail, ts) VALUES (?, ?, ?, ?, ?)", (t.task_id, step, state, detail, (started + timedelta(seconds=seconds)).isoformat()))
            conn.commit()
        return t

    def journeys(self, hours=24):
        out = self.repo.journeys(hours)
        return {(j["tmdb_id"], j["season"], j["episode"], j["kind"]): j for j in out["journeys"]}

    def test_retries_of_one_title_are_one_journey_with_every_try_in_order(self):
        self.task(5, at(30), IngestStatus.FAILED, season=1, episode=1, message="Extraction boom", events=[("extract", "failed", "all extractors failed", 5)])
        self.task(5, at(20), IngestStatus.FAILED, season=1, episode=1, events=[("extract", "ok", "", 5), ("verify", "failed", "too short", 40)])
        win = self.task(5, at(10), IngestStatus.STREAMING, season=1, episode=1, stream=True, events=[("request", "ok", "", 0), ("stream", "ok", "", 22)])
        journey = self.journeys()[(5, 1, 1, "video")]
        self.assertEqual(len(self.repo.journeys(24)["journeys"]), 1)
        self.assertEqual([t["status"] for t in journey["tasks"]], ["FAILED", "FAILED", "STREAMING"])
        first, second, last = journey["tasks"]
        self.assertEqual((first["failed_step"], first["failed_detail"]), ("extract", "all extractors failed"))
        self.assertEqual(second["failed_step"], "verify")
        self.assertTrue(last["watchable"] and not first["watchable"])
        self.assertEqual(last["task_id"], win.task_id)
        # "Stream ready" is when the viewer could start, not when caching finished.
        self.assertEqual(last["ready_at"], (at(10) + timedelta(seconds=22)).isoformat())

    def test_a_step_that_failed_and_then_worked_is_not_where_the_task_died(self):
        self.task(6, at(5), IngestStatus.COMPLETED, result=True, stream=True, events=[("verify", "failed", "short", 10), ("verify", "ok", "", 20), ("stream", "ok", "", 3)])
        self.assertIsNone(self.journeys()[(6, None, None, "video")]["tasks"][0]["failed_step"])

    def test_cache_failed_streaming_still_means_the_viewer_could_watch(self):
        self.task(7, at(5), IngestStatus.STREAMING, stream=True, cache_failed=True, message="caching skipped", events=[("stream", "ok", "", 12)])
        self.assertTrue(self.journeys()[(7, None, None, "video")]["tasks"][0]["watchable"])

    def test_never_watched_and_still_trying(self):
        self.task(8, at(50), IngestStatus.FAILED, events=[("extract", "failed", "No streams found", 4)])
        self.task(8, at(40), IngestStatus.FAILED, events=[("extract", "failed", "No streams found", 4)])
        self.task(9, at(1), IngestStatus.EXTRACTING, events=[("extract", "running", "", 1)])
        never = self.journeys()[(8, None, None, "video")]
        self.assertFalse(any(t["watchable"] for t in never["tasks"]))
        self.assertEqual(len(never["tasks"]), 2)
        self.assertEqual(self.journeys()[(9, None, None, "video")]["tasks"][0]["status"], "EXTRACTING")

    def test_sinhala_subtitles_are_their_own_journey_and_ready_when_the_job_finishes(self):
        self.task(10, at(20), IngestStatus.STREAMING, stream=True, events=[("stream", "ok", "", 5)])
        self.task(10, at(10), IngestStatus.COMPLETED, quality="sub:si:" + str(uuid.uuid4()), subs=[{"language": "si", "url": "u"}])
        self.task(10, at(9), IngestStatus.FAILED, quality="sub:si")
        found = self.journeys()
        self.assertEqual(set(found), {(10, None, None, "video"), (10, None, None, "sinhala")})
        sinhala = found[(10, None, None, "sinhala")]
        self.assertEqual([t["watchable"] for t in sinhala["tasks"]], [True, False])
        self.assertEqual(sinhala["tasks"][0]["ready_at"], sinhala["tasks"][0]["updated_at"])

    def test_the_window_limits_which_tasks_count(self):
        self.task(11, at(60 * 24 * 3), IngestStatus.FAILED)
        self.task(12, at(30), IngestStatus.STREAMING, stream=True)
        self.assertEqual({k[0] for k in self.journeys(24)}, {12})
        self.assertEqual({k[0] for k in self.journeys(168)}, {11, 12})

    def test_endpoint_returns_the_report_and_needs_the_secret(self):
        from fastapi.testclient import TestClient
        from app.api import routes
        from app.main import app

        self.task(13, at(5), IngestStatus.STREAMING, stream=True, events=[("stream", "ok", "", 9)])
        with mock.patch.object(routes, "_repository", self.repo):
            client = TestClient(app)
            self.assertEqual(client.get("/api/v1/media/pipeline/journeys").status_code, 401)
            res = client.get("/api/v1/media/pipeline/journeys?hours=24", headers={"X-Evo-Secret": "s3cret"})
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertEqual(body["window_hours"], 24)
            self.assertFalse(body["truncated"])
            self.assertEqual(body["journeys"][0]["tasks"][0]["watchable"], True)
            self.assertEqual(client.get("/api/v1/media/pipeline/journeys?hours=999", headers={"X-Evo-Secret": "s3cret"}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
