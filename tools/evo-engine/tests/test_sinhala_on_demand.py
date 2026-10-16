import threading
import unittest
from unittest import mock

import requests

from app.core.config import settings
from app.domain.models import IngestStatus, MediaType
from app.services.translation_service import BudgetExceeded
from app.services.webhook import WebhookNotifier
from tests.fakes import Hook, Subtitles, Translator, make_service, wait_until

_url = mock.patch.object(settings, "EVO_WEBHOOK_URL", "http://app.invalid/api/evo/complete")  # fakes never call it


def setUpModule():
    _url.start()


def tearDownModule():
    _url.stop()


ASK = dict(tmdb_id=42, media_type=MediaType.MOVIE, title="Test Movie", imdb_id="tt0123456", synopsis="A plot", characters=["Jon"])


def ask(svc, **over):
    return svc.request_sinhala(**{**ASK, **over})


def settled(svc, **over):
    kw = {**ASK, **over}
    return wait_until(svc, lambda: svc.sinhala_status(svc.find_sinhala_job(kw["tmdb_id"], kw["media_type"], kw.get("season"), kw.get("episode"))))


class OnDemandSinhala(unittest.TestCase):
    def test_translates_uploads_and_reports_through_the_webhook(self):
        hook = Hook()
        svc, repo, translator = make_service(hook=hook)
        first = ask(svc)
        self.assertEqual(first["state"], "running")
        done = settled(svc)
        self.assertEqual(done["state"], "done", done)
        self.assertEqual(done["subtitle"]["language"], "si")
        self.assertTrue(done["subtitle"]["url"].startswith("https://pixeldrain.com/api/file/"))
        self.assertEqual(translator.calls, 1)
        self.assertEqual(hook.subtitles, [done["job_id"]])
        self.assertEqual(hook.completed, [], "no video was cached, so only the subtitle webhook fires")

        events = {(e["step"], e["state"]) for e in repo.list_events(done["job_id"])}
        for expected in [("request", "ok"), ("subtitles", "ok"), ("translate", "ok"), ("subtitle_sync", "ok"), ("webhook", "ok")]:
            self.assertIn(expected, events)
        job = repo.get_by_id(done["job_id"])
        self.assertEqual(job.status, IngestStatus.COMPLETED)
        self.assertIsNone(job.result_url)

    def test_second_request_shares_the_finished_job(self):
        svc, _, translator = make_service()
        ask(svc)
        done = settled(svc)
        with mock.patch.object(svc, "_cdn_alive", return_value=True):
            again = ask(svc)
        self.assertEqual(again["state"], "done")
        self.assertEqual(again["job_id"], done["job_id"])
        self.assertEqual(translator.calls, 1)

    def test_simultaneous_viewers_share_one_running_job(self):
        gate = threading.Event()
        svc, repo, translator = make_service(gate=gate)
        results = []
        threads = [threading.Thread(target=lambda: results.append(ask(svc))) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual({r["job_id"] for r in results}, {results[0]["job_id"]}, "one job for everyone")
        self.assertTrue(all(r["state"] == "running" for r in results))
        gate.set()
        done = settled(svc)
        self.assertEqual(done["state"], "done")
        self.assertEqual(translator.calls, 1)
        self.assertEqual(len([t for t in repo.list_all(50) if t.requested_quality == "sub:si"]), 1)

    def test_running_job_reports_chunk_progress(self):
        gate = threading.Event()
        svc, _, _ = make_service(gate=gate)
        ask(svc)
        def status_fn():
            st = svc.sinhala_status(svc.find_sinhala_job(42, MediaType.MOVIE, None, None))
            return {**st, "state": "seen" if st.get("progress") else "waiting"}

        status = wait_until(svc, status_fn, states=("seen",))
        gate.set()
        self.assertEqual(status["progress"], {"done": 1, "total": 2})
        settled(svc)

    def test_episodes_are_separate_jobs(self):
        svc, _, translator = make_service()
        ask(svc, media_type=MediaType.TV, season=1, episode=1)
        settled(svc, media_type=MediaType.TV, season=1, episode=1)
        # The fake finds the same subtitle id for every episode, so the second one reads the cached translation.
        second = ask(svc, media_type=MediaType.TV, season=1, episode=2)
        self.assertNotEqual(second["state"], "none")
        self.assertEqual(len([t for t in svc.repository.list_all(50) if t.requested_quality == "sub:si"]), 2)

    def test_budget_cap_blocks_a_new_job(self):
        svc, repo, translator = make_service()
        repo.add_usage(None, "fake", settings.TRANSLATE_DAILY_BUDGET_USD, 1)
        out = ask(svc)
        self.assertEqual(out["state"], "unavailable")
        self.assertEqual(translator.calls, 0)
        self.assertEqual(repo.list_all(50), [], "no job is created when the cap is hit")

    def test_budget_hit_midway_reads_as_unavailable(self):
        svc, _, _ = make_service(error=BudgetExceeded("Daily translation budget ($0.50) reached"))
        ask(svc)
        out = settled(svc)
        self.assertEqual(out["state"], "unavailable", out)

    def test_not_configured_is_unavailable(self):
        svc, repo, _ = make_service(translator_factory=None)
        self.assertEqual(ask(svc)["state"], "unavailable")
        self.assertEqual(repo.list_all(50), [])

    def test_no_english_subtitle_fails_with_a_reason(self):
        svc, _, translator = make_service(subtitles=Subtitles([{"id": "sub_1_fr_1", "label": "French", "language": "fr", "format": "vtt", "url": "/f"}]))
        ask(svc)
        out = settled(svc)
        self.assertEqual(out["state"], "failed")
        self.assertIn("English subtitle", out["message"])
        self.assertEqual(translator.calls, 0)

    def test_failed_job_is_retried_by_the_next_request(self):
        svc, _, translator = make_service(error=RuntimeError("model down"))
        ask(svc)
        failed = settled(svc)
        self.assertEqual(failed["state"], "failed")
        translator.error = None
        retry = ask(svc)
        self.assertEqual(retry["state"], "running")
        self.assertNotEqual(retry["job_id"], failed["job_id"])
        self.assertEqual(settled(svc)["state"], "done")

    def test_job_whose_cdn_file_vanished_is_redone(self):
        svc, _, _ = make_service()
        ask(svc)
        done = settled(svc)
        with mock.patch.object(svc, "_cdn_alive", return_value=False):
            redo = ask(svc)
        self.assertNotEqual(redo["job_id"], done["job_id"])
        settled(svc)

    def test_existing_upstream_sinhala_track_costs_nothing(self):
        subs = Subtitles([{"id": "sub_1_si_9", "label": "Sinhala", "language": "si", "format": "vtt", "url": "/s"}])
        svc, repo, translator = make_service(subtitles=subs)
        ask(svc)
        out = settled(svc)
        self.assertEqual(out["state"], "done")
        self.assertEqual(translator.calls, 0)
        self.assertIn(("translate", "skipped"), {(e["step"], e["state"]) for e in repo.list_events(out["job_id"])})

    def test_admin_button_path_still_works(self):
        """translate_existing (the admin Translate button) adds a Sinhala track to a finished video task."""
        from tests.fakes import Hook

        hook = Hook()
        svc, repo, translator = make_service(hook=hook)
        task = svc.create_task(7, MediaType.MOVIE, "720p", runtime_minutes=100)
        svc.process_task(task.task_id)
        self.assertEqual(translator.calls, 0)
        svc.translate_existing(task.task_id)
        task = repo.get_by_id(task.task_id)
        self.assertEqual(translator.calls, 1)
        self.assertIn("si", [s["language"] for s in task.cdn_subtitles])
        events = {(e["step"], e["state"]) for e in repo.list_events(task.task_id)}
        for expected in [("translate", "ok"), ("subtitle_sync", "ok"), ("webhook", "ok")]:
            self.assertIn(expected, events)
        self.assertEqual(hook.completed, [task.task_id, task.task_id])


class SubtitleWebhook(unittest.TestCase):
    def test_subtitles_only_payload_has_no_video_fields(self):
        svc, repo, _ = make_service()
        ask(svc)
        done = settled(svc)
        job = repo.get_by_id(done["job_id"])
        sent = {}

        class Ok:
            status_code = 200
            text = ""

        def fake_post(url, json=None, headers=None, timeout=None):
            sent.update(json)
            return Ok()

        with mock.patch.object(requests, "post", fake_post):
            self.assertTrue(WebhookNotifier().notify_subtitles(job))
        self.assertEqual(sent["tmdbId"], 42)
        self.assertEqual(sent["mediaType"], "movie")
        self.assertEqual(sent["subtitles"][0]["language"], "si")
        self.assertNotIn("resultUrl", sent)
        self.assertNotIn("quality", sent)


class HttpLayer(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient

        from app.api import routes
        from app.main import app

        self.svc, _, _ = make_service()
        self.patch = mock.patch.object(routes, "_service_instance", self.svc)
        self.patch.start()
        self.client = TestClient(app)
        self.h = {"X-Evo-Secret": "s3cret"}
        self.body = {"tmdb_id": 42, "media_type": "movie", "title": "Test Movie", "imdb_id": "tt0123456"}

    def tearDown(self):
        self.patch.stop()

    def test_needs_the_secret(self):
        self.assertEqual(self.client.post("/api/v1/media/subtitles/si", json=self.body).status_code, 401)
        self.assertEqual(self.client.get("/api/v1/media/subtitles/si", params={"tmdb_id": 42}).status_code, 401)

    def test_validates_input(self):
        url = "/api/v1/media/subtitles/si"
        self.assertEqual(self.client.post(url, json={**self.body, "media_type": "tv"}, headers=self.h).status_code, 422, "tv needs season and episode")
        self.assertEqual(self.client.post(url, json={**self.body, "imdb_id": "nope"}, headers=self.h).status_code, 422)
        self.assertEqual(self.client.post(url, json={**self.body, "tmdb_id": 0}, headers=self.h).status_code, 422)
        self.assertEqual(self.client.get(url, params={"tmdb_id": 42, "media_type": "bogus"}, headers=self.h).status_code, 422)

    def test_start_then_poll_without_any_task_id(self):
        started = self.client.post("/api/v1/media/subtitles/si", json=self.body, headers=self.h).json()
        self.assertIn(started["state"], ("running", "done"))
        self.assertEqual(self.client.get("/api/v1/media/subtitles/si", params={"tmdb_id": 999}, headers=self.h).json()["state"], "none")
        out = wait_until(self.svc, lambda: self.client.get("/api/v1/media/subtitles/si", params={"tmdb_id": 42}, headers=self.h).json())
        self.assertEqual(out["state"], "done")

    def test_subtitle_file_route_is_not_shadowed(self):
        self.assertEqual(self.client.get("/api/v1/media/subtitles/sub_1_en_1.vtt", headers=self.h).status_code, 404)


if __name__ == "__main__":
    unittest.main()
