import unittest
from unittest import mock

from app.core.config import settings
from app.domain.models import IngestStatus, MediaType
from tests.fakes import make_service

HEADERS = {"X-Evo-Secret": "s3cret"}
BODY = {"tmdb_id": 11, "media_type": "movie", "quality": "720p"}


class BusyRefusal(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from app.api import routes
        from app.main import app

        self.routes = routes
        self.client = TestClient(app)
        self.svc, self.repo, _ = make_service()
        patches = [
            mock.patch.object(routes, "_service_instance", self.svc),
            mock.patch.object(routes, "_repository", self.repo),
            mock.patch.object(settings, "MAX_QUEUED_TASKS", 0),  # every enqueue is refused: the queue is "full"
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def post(self):
        return self.client.post("/api/v1/media/ingest", json=BODY, headers=HEADERS)

    def test_create_or_join_says_whether_it_made_the_task(self):
        first, created = self.svc.create_or_join(11, MediaType.MOVIE, "720p")
        again, created_again = self.svc.create_or_join(11, MediaType.MOVIE, "720p")
        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(first.task_id, again.task_id)

    def test_a_refused_new_request_answers_busy_and_leaves_no_failed_row(self):
        res = self.post()
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.headers["Retry-After"], "30")
        self.assertIn("busy", res.json()["detail"].lower())
        self.assertIsNone(self.repo.get_by_tmdb_id(11, "movie", "720p"))
        # Retrying while it is still full must not pile up rows either.
        self.assertEqual(self.post().status_code, 503)
        self.assertIsNone(self.repo.get_by_tmdb_id(11, "movie", "720p"))

    def test_a_task_that_is_already_waiting_keeps_its_place(self):
        waiting = self.svc.create_task(11, MediaType.MOVIE, "720p")
        res = self.post()
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["task_id"], waiting.task_id)
        self.assertEqual(self.repo.get_by_id(waiting.task_id).status, IngestStatus.PENDING)


if __name__ == "__main__":
    unittest.main()
