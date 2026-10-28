import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.services.subtitle_service import SubtitleService


def srt(cues=50, text="A readable subtitle line"):
    return "\n\n".join(
        f"{i}\n00:00:{i:02d},000 --> 00:00:{i:02d},900\n{text}"
        for i in range(1, cues + 1)
    ).encode()


class Response:
    def __init__(self, status, content=b""):
        self.status_code = status
        self.content = content


class SubtitleFallback(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.service = SubtitleService(self.root)

    def test_fetch_keeps_up_to_five_candidates_and_returns_best(self):
        items = [
            {"SubDownloadLink": f"https://example/{i}", "IDSubtitleFile": str(i), "SubDownloadsCnt": str(10 - i), "MovieReleaseName": f"release {i}"}
            for i in range(7)
        ]
        response = Response(200)
        response.json = lambda: items
        with mock.patch("app.services.subtitle_service.requests.get", return_value=response):
            tracks = self.service.fetch_subtitles("tt1234567")
        track = next(t for t in tracks if t["language"] == "en")
        self.assertEqual(track["id"], "sub_1234567_en_0")
        self.assertEqual(len(self.service._meta_cache[track["id"]]["candidates"]), 5)
        self.assertEqual(self.service._meta_cache[track["id"]]["candidates"][1]["release"], "release 1")

    def test_retries_bad_status_then_uses_next_candidate(self):
        self.service._meta_cache["test"] = {"episode": False, "candidates": [
            {"dl_link": "https://example/first", "rank": 1},
            {"dl_link": "https://example/second", "rank": 2},
        ]}
        get = mock.Mock(side_effect=[Response(429), Response(429), Response(429), Response(200, srt())])
        with mock.patch("app.services.subtitle_service.requests.Session") as session, mock.patch("app.services.subtitle_service.time.sleep"):
            session.return_value.get = get
            value = self.service.get_vtt("test")
        self.assertTrue(value.startswith("WEBVTT"))
        self.assertEqual(get.call_count, 4)

    def test_garbage_candidate_is_rejected_and_fallback_is_used(self):
        self.service._meta_cache["test"] = {"episode": False, "candidates": [
            {"dl_link": "https://example/garbage", "rank": 1},
            {"dl_link": "https://example/good", "rank": 2},
        ]}
        with mock.patch("app.services.subtitle_service.requests.Session") as session, mock.patch("app.services.subtitle_service.time.sleep"):
            session.return_value.get = mock.Mock(side_effect=[Response(200, b"not subtitles"), Response(200, srt())])
            self.assertIsNotNone(self.service.get_vtt("test"))

    def test_all_candidates_fail_exposes_clear_reason(self):
        self.service._meta_cache["test"] = {"episode": False, "candidates": [{"dl_link": "https://example/x", "rank": 1}]}
        with mock.patch("app.services.subtitle_service.requests.Session") as session, mock.patch("app.services.subtitle_service.time.sleep"):
            session.return_value.get = mock.Mock(return_value=Response(403))
            self.assertIsNone(self.service.get_vtt("test"))
        self.assertIn("HTTP 403", self.service.get_last_error("test"))

    def test_old_string_cache_format_still_loads(self):
        (self.root / "index.json").write_text(json.dumps({"legacy": "https://example/legacy"}))
        service = SubtitleService(self.root)
        with mock.patch("app.services.subtitle_service.requests.Session") as session:
            session.return_value.get.return_value = Response(200, srt())
            self.assertIsNotNone(service.get_vtt("legacy"))


if __name__ == "__main__":
    unittest.main()
