import unittest
from unittest import mock

from app.core.config import settings
from app.domain.models import IngestStatus, MediaType
from tests.fakes import Hook, make_service


_url = mock.patch.object(settings, "EVO_WEBHOOK_URL", "http://app.invalid/api/evo/complete")  # the fake hook never calls it


def setUpModule():
    _url.start()


def tearDownModule():
    _url.stop()


class IngestPipelineEvents(unittest.TestCase):
    def run_pipeline(self, **kw):
        hook = Hook()
        svc, repo, translator = make_service(hook=hook, **kw)
        task = svc.create_task(1, MediaType.MOVIE, "720p", runtime_minutes=100)
        svc.process_task(task.task_id)
        return svc, repo, translator, hook, repo.get_by_id(task.task_id)

    def test_pipeline_does_not_translate_on_its_own(self):
        svc, repo, translator, hook, task = self.run_pipeline()
        self.assertEqual(task.status, IngestStatus.COMPLETED)
        self.assertEqual(translator.calls, 0, "ingest must not spend translation budget")
        self.assertEqual(repo.usage_today(), 0)
        # English and the other languages still ship to the CDN; no Sinhala track is made.
        self.assertEqual([s["language"] for s in task.cdn_subtitles], ["en", "es"])
        self.assertEqual(hook.completed, [task.task_id])

    def test_translate_node_reads_skipped_on_demand(self):
        _, repo, _, _, task = self.run_pipeline()
        events = repo.list_events(task.task_id)
        translate = [e for e in events if e["step"] == "translate"]
        self.assertEqual([e["state"] for e in translate], ["skipped"])
        self.assertIn("on demand", translate[0]["detail"].lower())
        steps = {(e["step"], e["state"]) for e in events}
        for expected in [("request", "ok"), ("extract", "ok"), ("subtitles", "ok"), ("stream", "ok"), ("subtitle_sync", "ok"), ("upload", "ok")]:
            self.assertIn(expected, steps)

    def test_cached_twin_reuses_files_without_translating(self):
        svc, repo, translator, _, first = self.run_pipeline()
        second = svc.create_task(1, MediaType.MOVIE, "1080p")  # resolves to the already cached 720p
        svc.process_task(second.task_id)
        events = {(e["step"], e["state"]) for e in repo.list_events(second.task_id)}
        self.assertIn(("cdn_check", "skipped"), events)
        self.assertIn(("subtitle_sync", "skipped"), events)
        self.assertIn(("translate", "skipped"), events)
        self.assertEqual(translator.calls, 0)

    def test_no_translator_configured_is_fine(self):
        _, _, _, _, task = self.run_pipeline(translator_factory=None)
        self.assertEqual(task.status, IngestStatus.COMPLETED)


if __name__ == "__main__":
    unittest.main()
