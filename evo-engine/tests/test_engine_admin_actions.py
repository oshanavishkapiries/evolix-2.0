import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

from app.api import routes
from app.domain.models import IngestStatus
from app.services.subtitle_service import SubtitleService


class Task:
    def __init__(self, status):
        self.status = status


class Restart(unittest.TestCase):
    def call(self, tasks, **kw):
        timer = mock.Mock()
        with mock.patch.object(routes._repository, "list_all", return_value=tasks), mock.patch.object(routes.threading, "Timer", return_value=timer) as make:
            out = routes.restart_engine(**kw)
        return out, make, timer

    def test_an_idle_engine_restarts_after_it_has_answered(self):
        out, make, timer = self.call([Task(IngestStatus.COMPLETED)], force=False)
        self.assertEqual(out, {"restarting": True, "running": 0})
        self.assertEqual(make.call_args.args[:2], (routes.RESTART_DELAY_S, routes._exit_process))
        timer.start.assert_called_once()

    def test_running_jobs_block_it_unless_forced(self):
        busy = [Task(IngestStatus.EXTRACTING), Task(IngestStatus.UPLOADING), Task(IngestStatus.COMPLETED)]
        with self.assertRaises(HTTPException) as e:
            self.call(busy, force=False)
        self.assertEqual(e.exception.status_code, 409)
        self.assertIn("2 job(s)", e.exception.detail)
        out, _, timer = self.call(busy, force=True)
        self.assertEqual(out["running"], 2)
        timer.start.assert_called_once()

    def test_the_process_exits_with_a_non_zero_code_so_every_restart_policy_applies(self):
        with mock.patch.object(routes.os, "_exit") as bye:
            routes._exit_process()
        bye.assert_called_once_with(3)


class SinhalaCache(unittest.TestCase):
    def test_only_cached_translations_are_removed(self):
        with tempfile.TemporaryDirectory() as d:
            svc = SubtitleService(cache_dir=Path(d))
            for name in ("si_aaa.vtt", "si_bbb.vtt", "sub_1_en_2.vtt", "upload_x.vtt", "index.json"):
                (Path(d) / name).write_text("x")
            self.assertEqual(svc.purge_translations(), 2)
            self.assertEqual(sorted(p.name for p in Path(d).iterdir()), ["index.json", "sub_1_en_2.vtt", "upload_x.vtt"])
            self.assertEqual(svc.purge_translations(), 0)

    def test_after_a_purge_the_next_request_translates_again(self):
        with tempfile.TemporaryDirectory() as d:
            svc = SubtitleService(cache_dir=Path(d))
            svc.save_vtt("si_abc", "WEBVTT\n")
            self.assertTrue(svc.has_vtt("si_abc"))
            svc.purge_translations()
            self.assertFalse(svc.has_vtt("si_abc"))


if __name__ == "__main__":
    unittest.main()
