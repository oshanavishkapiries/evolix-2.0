import base64
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.domain.models import IngestStatus, UploadResult
from app.services.subtitle_service import SubtitleService, validate_subtitle
from tests.fakes import make_service, wait_until
from tests.test_subtitle_fallback import Response, srt


class SubtitleValidation(unittest.TestCase):
    def test_movies_and_episodes_have_different_minimums(self):
        self.assertTrue(validate_subtitle(srt(20), episode=True).startswith('WEBVTT'))
        with self.assertRaisesRegex(ValueError, 'at least 50'):
            validate_subtitle(srt(20))

    def test_strips_scripts_html_and_decodes_legacy_text(self):
        clean = validate_subtitle(srt(text='<script>alert(1)</script><i>café</i>'))
        self.assertNotIn('<script', clean)
        self.assertNotIn('alert(1)', clean)
        self.assertIn('café', clean)
        legacy = srt(text='café').decode().encode('cp1252')
        self.assertIn('caf', validate_subtitle(legacy))

    def test_rejects_empty_huge_invalid_and_out_of_order_files(self):
        for raw in (b'', b'x' * (2 * 1024 * 1024 + 1), b'\xff\xfe\x00broken'):
            with self.assertRaises(ValueError):
                validate_subtitle(raw)
        bad = srt().replace(b'00:00:02,000', b'00:00:00,000')
        with self.assertRaisesRegex(ValueError, 'ordered'):
            validate_subtitle(bad)

    def test_downloads_skip_a_few_bad_cues_but_uploads_stay_strict(self):
        cues = [f"{i}\n00:{i // 60:02d}:{i % 60:02d},000 --> 00:{i // 60:02d}:{i % 60:02d},900\nLine {i}" for i in range(1, 61)]
        cues[10] = "11\n00:00:40,000 --> 00:00:40,000\nzero length"
        cues[20] = "21\n00:00:41,00 --> 00:00:42,00\nshort milliseconds"
        cues[30] = "31\n00:00:31,000 --> 00:00:31,900\n"
        raw = "\n\n".join(cues).encode()
        vtt = validate_subtitle(raw, strict=False)
        self.assertEqual(vtt.count("-->"), 57)
        with self.assertRaises(ValueError):
            validate_subtitle(raw)
        many_bad = "\n\n".join(c if i % 4 else f"{i}\n00:00:05,000 --> 00:00:05,000\nbad" for i, c in enumerate(cues)).encode()
        with self.assertRaisesRegex(ValueError, "too many invalid cues"):
            validate_subtitle(many_bad, strict=False)

    def test_overlapping_starts_are_kept_for_downloads(self):
        cues = [f"{i}\n00:{i // 60:02d}:{i % 60:02d},000 --> 00:{i // 60:02d}:{i % 60:02d},900\nLine {i}" for i in range(1, 61)]
        cues[30] = "31\n00:00:10,000 --> 00:00:12,000\nSimultaneous speaker"
        self.assertEqual(validate_subtitle("\n\n".join(cues).encode(), strict=False).count("-->"), 60)

    def test_a_stray_less_than_sign_does_not_swallow_the_next_cue(self):
        cues = [f"{i}\n00:{i // 60:02d}:{i % 60:02d},000 --> 00:{i // 60:02d}:{i % 60:02d},900\nLine {i}" for i in range(1, 61)]
        cues[10] = "11\n00:00:11,000 --> 00:00:11,900\nI <3 you"
        vtt = validate_subtitle("\n\n".join(cues).encode())
        self.assertEqual(vtt.count("-->"), 60)
        self.assertIn("I &lt;3 you", vtt)

    def test_rejects_runtime_mismatch(self):
        with self.assertRaisesRegex(ValueError, 'runtime'):
            validate_subtitle(srt(), runtime_minutes=100)
        self.assertTrue(validate_subtitle(srt(52), runtime_minutes=1))

    def test_accepts_webvtt_without_duplicating_header(self):
        first = validate_subtitle(srt())
        self.assertEqual(validate_subtitle(first.encode()).count('WEBVTT'), 1)


class SubtitleJobs(unittest.TestCase):
    def test_failed_starts_are_limited_for_the_title_even_when_source_changes(self):
        subtitles = SubtitleService(Path(tempfile.mkdtemp()))
        svc, repo, _ = make_service(subtitles=subtitles)
        with mock.patch.object(subtitles, 'get_vtt', return_value=None):
            started = svc.request_sinhala(42, source_track_id='11111111-1111-4111-8111-111111111111', source_url='https://pixeldrain.com/api/file/source')
            out = wait_until(svc, lambda: svc.sinhala_status(repo.get_by_id(started['job_id'])))
            self.assertEqual(out['state'], 'failed')
            retry = svc.request_sinhala(42, source_track_id='22222222-2222-4222-8222-222222222222', source_url='https://pixeldrain.com/api/file/other')
        self.assertFalse(retry['created'])
        self.assertEqual(len(repo.list_all(50)), 1)

    def test_dead_first_candidate_still_finishes_sinhala_without_a_failed_task(self):
        subtitles = SubtitleService(Path(tempfile.mkdtemp()))
        svc, repo, translator = make_service(subtitles=subtitles)
        search = Response(200)
        search.json = lambda: [
            {'SubDownloadLink': 'https://example.invalid/dead', 'IDSubtitleFile': '1'},
            {'SubDownloadLink': 'https://example.invalid/good', 'IDSubtitleFile': '2'},
        ]
        def get(url, **kw):
            return Response(429) if url.endswith('/dead') else Response(200, srt())
        with mock.patch('app.services.subtitle_service.SUPPORTED_LANGUAGES', [{'os_code': 'eng', 'lang': 'en', 'label': 'English'}]), mock.patch('app.services.subtitle_service.requests.get', return_value=search), mock.patch('app.services.subtitle_service.requests.Session') as session, mock.patch('app.services.subtitle_service.time.sleep'):
            session.return_value.get.side_effect = get
            started = svc.request_sinhala(42, imdb_id='tt1234567')
            out = wait_until(svc, lambda: svc.sinhala_status(repo.get_by_id(started['job_id'])))
        self.assertEqual(out['state'], 'done', out)
        self.assertEqual(translator.calls, 1)
        self.assertEqual(len([t for t in repo.list_all(50) if t.status == IngestStatus.FAILED]), 0)

    def test_source_specific_jobs_are_separate_and_reused_with_cost_ledger(self):
        subtitles = SubtitleService(Path(tempfile.mkdtemp()))
        svc, repo, translator = make_service(subtitles=subtitles)
        ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
        jobs = []
        with mock.patch('app.services.subtitle_service.requests.Session') as session, mock.patch.object(svc, '_cdn_alive', return_value=True):
            session.return_value.get.return_value = Response(200, srt())
            for source in ids:
                started = svc.request_sinhala(42, source_track_id=source, source_url='https://pixeldrain.com/api/file/source')
                out = wait_until(svc, lambda: svc.sinhala_status(repo.get_by_id(started['job_id'])))
                self.assertEqual(out['state'], 'done', out)
                jobs.append(out['job_id'])
            again = svc.request_sinhala(42, source_track_id=ids[0], source_url='https://pixeldrain.com/api/file/source')
        self.assertEqual(again['job_id'], jobs[0])
        self.assertNotEqual(jobs[0], jobs[1])
        self.assertEqual(translator.calls, 2)
        self.assertAlmostEqual(repo.usage_today(), 0.02)


class SubtitleEndpoints(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from app.api import routes
        from app.main import app
        self.routes = routes
        self.client = TestClient(app)
        self.headers = {'X-Evo-Secret': 's3cret'}
        self.subtitles = SubtitleService(Path(tempfile.mkdtemp()))

    def test_upload_validates_before_storage(self):
        with mock.patch.object(self.routes, '_subtitle_service', self.subtitles), mock.patch.object(self.routes._storage, 'upload_file') as upload:
            body = {'file_name': 'bad.srt', 'content_base64': base64.b64encode(b'garbage').decode()}
            self.assertEqual(self.client.post('/api/v1/media/subtitles/upload', json=body, headers=self.headers).status_code, 422)
            upload.assert_not_called()

    def test_source_url_cannot_target_arbitrary_hosts(self):
        body = {'tmdb_id': 42, 'source_track_id': '11111111-1111-4111-8111-111111111111', 'source_url': 'http://127.0.0.1/private'}
        self.assertEqual(self.client.post('/api/v1/media/subtitles/si', json=body, headers=self.headers).status_code, 422)

    def test_valid_upload_is_published_once_and_cdn_delete_clears_its_cache(self):
        result = UploadResult('pixeldrain', 'uploaded', 'https://pixeldrain.com/api/file/uploaded', 100)
        body = {'file_name': 'valid.srt', 'content_base64': base64.b64encode(srt()).decode()}
        with mock.patch.object(self.routes, '_subtitle_service', self.subtitles), mock.patch.object(self.routes._storage, 'upload_file', return_value=result) as upload, mock.patch.object(self.routes._storage, 'delete_file'):
            for _ in range(2):
                response = self.client.post('/api/v1/media/subtitles/upload', json=body, headers=self.headers)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['url'], result.direct_url)
            self.assertEqual(upload.call_count, 1)
            deleted = self.client.post('/api/v1/media/cdn/delete', json={'url': result.direct_url}, headers=self.headers)
            self.assertEqual(deleted.status_code, 200)
            self.assertEqual(self.client.post('/api/v1/media/subtitles/upload', json=body, headers=self.headers).status_code, 200)
            self.assertEqual(upload.call_count, 2)


if __name__ == '__main__':
    unittest.main()
