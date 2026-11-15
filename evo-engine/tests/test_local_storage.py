"""Local CDN invariants and HTTP transport, entirely offline with byte-sized quotas."""
import asyncio
import tempfile
import threading
import shutil
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.requests import Request

from app.core import runtime_config
from app.core.config import settings
from app.services import storage
from app.services.local_files import file_response
from app.services.local_storage import LocalDiskStorageProvider, validate_file_id
from app.services.ingest_service import IngestService
from app.services.subtitle_service import SubtitleService
from app.api.schemas import SinhalaSubtitleRequest

GIB = 1024**3


class LocalStorage(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        patch = mock.patch.multiple(settings, CDN_PROVIDER="local", LOCAL_CDN_DIR=self.root / "cdn",
                                    LOCAL_CDN_VIDEO_GB=10 / GIB, LOCAL_CDN_SUBTITLE_GB=5 / GIB,
                                    MIN_FREE_DISK_GB=0, EVO_SECRET_TOKEN="s3cret")
        patch.start()
        self.addCleanup(patch.stop)
        self.provider = storage.local_storage()
        self.addCleanup(self.provider.db.close)
        self.addCleanup(lambda: storage._local.pop(str((self.root / "cdn").resolve()), None))
        self.count = 0

    def upload(self, data=b"12345", ext="mp4"):
        self.count += 1
        path = self.root / f"source{self.count}.{ext}"
        path.write_bytes(data)
        return self.provider.upload_file(path)

    def test_lru_touches_reorder_eviction(self):
        first, second = self.upload(), self.upload()
        handle = self.provider.open_file(first.file_id)
        self.provider.close_file(first.file_id, handle)
        third = self.upload()
        self.assertTrue(self.provider.exists(first.file_id))
        self.assertFalse(self.provider.exists(second.file_id))
        self.assertTrue(self.provider.exists(third.file_id))
        self.assertEqual(self.provider.usage()["videos"]["used_bytes"], 10)

    def test_independent_video_and_subtitle_quotas(self):
        video = self.upload(b"v" * 10)
        old = self.upload(b"abcde", "vtt")
        new = self.upload(b"sub", "vtt")
        self.assertTrue(self.provider.exists(video.file_id))
        self.assertFalse(self.provider.exists(old.file_id))
        self.assertTrue(self.provider.exists(new.file_id))
        self.assertEqual(self.provider.usage()["subtitles"]["used_bytes"], 3)

    def test_oversize_rejects_before_evicting(self):
        first = self.upload()
        with self.assertRaisesRegex(ValueError, "exceeds.*quota"):
            self.upload(b"x" * 11)
        self.assertTrue(self.provider.exists(first.file_id))
        with mock.patch.object(settings, "LOCAL_CDN_SUBTITLE_GB", 0):
            with self.assertRaisesRegex(ValueError, "quota"):
                self.upload(b"s", "vtt")

    def test_pins_prevent_eviction_delete_and_purge(self):
        first = self.upload(b"x" * 10)
        handle = self.provider.open_file(first.file_id)
        try:
            with self.assertRaisesRegex(RuntimeError, "currently being served"):
                self.upload()
            with self.assertRaisesRegex(RuntimeError, "currently being served"):
                self.provider.delete_file(first.file_id)
            self.assertEqual(self.provider.purge()["pinned"], 1)
            self.assertEqual(handle.read(), b"x" * 10)
        finally:
            self.provider.close_file(first.file_id, handle)
        self.assertEqual(self.provider.purge()["deleted"], 1)

    def test_atomic_write_failure_keeps_no_partial_publication(self):
        first = self.upload()
        with mock.patch("app.services.local_storage.os.replace", side_effect=OSError("disk failed")):
            with self.assertRaisesRegex(OSError, "disk failed"):
                self.upload(b"new")
        self.assertEqual([f["id"] for f in self.provider.list_files()], [first.file_id])
        self.assertEqual(list((self.root / "cdn/videos").glob("*.tmp")), [])

    def test_publication_occurs_only_after_complete_copy(self):
        original = __import__("os").replace
        seen = []

        def replace(source, destination):
            seen.append(Path(source).read_bytes())
            self.assertFalse(Path(destination).exists())
            original(source, destination)

        with mock.patch("app.services.local_storage.os.replace", side_effect=replace):
            result = self.upload(b"abcdefghij")
        self.assertEqual(seen, [b"abcdefghij"])
        self.assertEqual(result.direct_url, f"evo-local://{result.file_id}")
        self.assertEqual(result.storage_provider, "local")
        self.assertEqual(result.size_bytes, 10)

    def test_concurrent_uploads_never_exceed_quota_or_leave_temporary_files(self):
        paths = []
        for i in range(30):
            path = self.root / f"thread{i}.mp4"
            path.write_bytes(bytes([i]) * 3)
            paths.append(path)
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(self.provider.upload_file, paths))
        self.assertEqual(len(set(r.file_id for r in results)), 30)
        usage = self.provider.usage()["videos"]
        self.assertEqual(usage["used_bytes"], 9)
        self.assertEqual(usage["file_count"], 3)
        self.assertEqual(list((self.root / "cdn/videos").glob("*.tmp")), [])

    def test_playback_does_not_wait_for_a_slow_upload_copy(self):
        existing = self.upload()
        path = self.root / "slow.mp4"
        path.write_bytes(b"new")
        copying, release = threading.Event(), threading.Event()
        original_copy = shutil.copyfileobj

        def slow_copy(source, target, length):
            copying.set()
            if not release.wait(5):
                raise RuntimeError("Test did not release the slow copy")
            original_copy(source, target, length)

        client = self.client()
        with mock.patch("app.services.local_storage.shutil.copyfileobj", side_effect=slow_copy), ThreadPoolExecutor(max_workers=3) as pool:
            pending = pool.submit(self.provider.upload_file, path)
            try:
                self.assertTrue(copying.wait(2))

                def read_existing():
                    handle = self.provider.open_file(existing.file_id)
                    try:
                        return handle.read()
                    finally:
                        self.provider.close_file(existing.file_id, handle)

                self.assertEqual(pool.submit(read_existing).result(timeout=2), b"12345")
                response = pool.submit(client.get, f"/api/v1/media/files/{existing.file_id}", headers={"X-Evo-Secret": "s3cret"}).result(timeout=2)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, b"12345")
                self.assertFalse(pending.done())
            finally:
                release.set()
            pending.result(timeout=2)
        self.assertEqual(self.provider.reserved, {"videos": 0, "subtitles": 0})

    def test_concurrent_copies_reserve_space_and_wait_without_overshooting(self):
        paths = [self.root / f"reserved{i}.mp4" for i in range(3)]
        for path in paths:
            path.write_bytes(b"1234")
        release, first_two, third_copy = threading.Event(), threading.Event(), threading.Event()
        started, counter_lock = [], threading.Lock()
        original_copy = shutil.copyfileobj

        def slow_copy(source, target, length):
            with counter_lock:
                started.append(Path(source.name).name)
                if len(started) == 2:
                    first_two.set()
                if len(started) == 3:
                    third_copy.set()
            if not release.wait(5):
                raise RuntimeError("Test did not release concurrent copies")
            original_copy(source, target, length)

        with mock.patch("app.services.local_storage.shutil.copyfileobj", side_effect=slow_copy), ThreadPoolExecutor(max_workers=3) as pool:
            pending = [pool.submit(self.provider.upload_file, path) for path in paths[:2]]
            try:
                self.assertTrue(first_two.wait(2))
                pending.append(pool.submit(self.provider.upload_file, paths[2]))
                with self.provider.lock:
                    self.assertEqual(self.provider.reserved["videos"], 8)
                    self.assertEqual(self.provider.usage()["videos"]["used_bytes"], 0)
                self.assertFalse(third_copy.wait(0.1), "A third copy would exceed the 10-byte quota")
            finally:
                release.set()
            results = [future.result(timeout=2) for future in pending]
        self.assertEqual(len(results), 3)
        self.assertEqual(self.provider.reserved["videos"], 0)
        self.assertEqual(self.provider.usage()["videos"]["used_bytes"], 8)
        self.assertEqual(list((self.root / "cdn/videos").glob("*.tmp")), [])

    def test_failed_copy_releases_reservation_and_wakes_waiting_upload(self):
        first, second = self.root / "fails.mp4", self.root / "waits.mp4"
        first.write_bytes(b"12345678")
        second.write_bytes(b"12345")
        copying, release = threading.Event(), threading.Event()
        original_copy = shutil.copyfileobj

        def copy(source, target, length):
            if Path(source.name) == first:
                copying.set()
                if not release.wait(5):
                    raise RuntimeError("Test did not release failed copy")
                raise OSError("Copy failed")
            original_copy(source, target, length)

        with mock.patch("app.services.local_storage.shutil.copyfileobj", side_effect=copy), ThreadPoolExecutor(max_workers=2) as pool:
            failure = pool.submit(self.provider.upload_file, first)
            try:
                self.assertTrue(copying.wait(2))
                waiting = pool.submit(self.provider.upload_file, second)
                self.assertEqual(self.provider.reserved["videos"], 8)
            finally:
                release.set()
            with self.assertRaisesRegex(OSError, "Copy failed"):
                failure.result(timeout=2)
            result = waiting.result(timeout=2)
        self.assertTrue(self.provider.exists(result.file_id))
        self.assertEqual(self.provider.reserved["videos"], 0)
        self.assertEqual(self.provider.usage()["videos"]["used_bytes"], 5)

    def test_touch_throttles_database_and_utime_updates_for_sixty_seconds(self):
        result = self.upload()
        statements = []
        self.provider.db.set_trace_callback(statements.append)
        self.addCleanup(self.provider.db.set_trace_callback, None)
        with mock.patch("app.services.local_storage.time.monotonic", side_effect=[100, 159.99, 160]), mock.patch("app.services.local_storage.os.utime", wraps=__import__("os").utime) as utime:
            self.provider.touch(result.file_id)
            self.provider.touch(result.file_id)
            self.assertEqual(utime.call_count, 1)
            self.provider.touch(result.file_id)
            self.assertEqual(utime.call_count, 2)
        self.assertEqual(sum(sql.startswith("UPDATE files SET accessed") for sql in statements), 2)
        self.assertEqual(statements.count("COMMIT"), 2)
        self.provider.delete_file(result.file_id)
        self.assertNotIn(result.file_id, self.provider.last_touch)

    def test_minimum_free_disk_is_enforced(self):
        with mock.patch.object(settings, "MIN_FREE_DISK_GB", 1), mock.patch("app.services.local_storage.shutil.disk_usage", return_value=mock.Mock(free=2)):
            with self.assertRaisesRegex(RuntimeError, "MIN_FREE_DISK_GB"):
                self.upload()

    def test_strict_ids_and_symlinks_cannot_escape_directory(self):
        for bad in ("../private", "/etc/passwd", "a.mp4", "a" * 32 + ".mp4/..", "a" * 32 + ".mp4%00", "a" * 32 + ".mp4?x"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                validate_file_id(bad)
        outside = self.root / "private"
        outside.write_text("secret")
        fid = "a" * 32 + ".mp4"
        (self.root / "cdn/videos" / fid).symlink_to(outside)
        self.assertFalse(self.provider.exists(fid))
        with self.assertRaises(FileNotFoundError):
            self.provider.open_file(fid)

    def test_restart_recovers_unindexed_rename_and_removes_incomplete_files(self):
        first = self.upload()
        self.provider.db.execute("DELETE FROM files")
        self.provider.db.commit()
        (self.root / "cdn/videos/unfinished.tmp").write_bytes(b"partial")
        restarted = LocalDiskStorageProvider(self.root / "cdn")
        try:
            self.assertEqual(restarted.list_files()[0]["id"], first.file_id)
            self.assertFalse((self.root / "cdn/videos/unfinished.tmp").exists())
        finally:
            restarted.db.close()

    def test_runtime_provider_switch_and_liveness(self):
        selected = storage.RuntimeStorageProvider()
        path = self.root / "file.mp4"
        path.write_bytes(b"local")
        result = selected.upload_file(path)
        self.assertTrue(IngestService._cdn_alive(result.direct_url))
        with mock.patch.object(settings, "CDN_PROVIDER", "pixeldrain"), mock.patch.object(storage._pixeldrain, "upload_file", return_value="remote") as upload:
            self.assertEqual(selected.upload_file(path), "remote")
            upload.assert_called_once()
            self.assertTrue(IngestService._cdn_alive(result.direct_url))
        self.provider.delete_file(result.file_id)
        self.assertFalse(IngestService._cdn_alive(result.direct_url))
        self.assertFalse(IngestService._cdn_alive("evo-local://../private"))
        with mock.patch("app.services.ingest_service.requests.get", return_value=mock.Mock(status_code=404)):
            self.assertFalse(IngestService._cdn_alive("https://pixeldrain.com/api/file/test"))

    def test_evicted_completed_task_is_reingested(self):
        from tests.fakes import make_service
        from app.domain.models import IngestStatus
        service, repository, _ = make_service()
        task = service.create_task(19)
        task.status = IngestStatus.COMPLETED
        task.result_url = self.upload().direct_url
        repository.save(task)
        self.assertFalse(service.create_or_join(19)[1])
        self.provider.purge()
        replacement, created = service.create_or_join(19)
        self.assertTrue(created)
        self.assertNotEqual(replacement.task_id, task.task_id)

    def test_evicted_twin_is_not_reused_and_upload_failure_keeps_streaming(self):
        from tests.fakes import make_service
        from app.domain.models import IngestStatus
        service, repository, _ = make_service()
        service.storage = storage.RuntimeStorageProvider()
        with mock.patch.object(settings, "LOCAL_CDN_VIDEO_GB", 1), mock.patch.object(settings, "LOCAL_CDN_SUBTITLE_GB", 1):
            first = service.create_task(23)
            service.process_task(first.task_id)
            first = repository.get_by_id(first.task_id)
            self.assertEqual(first.status, IngestStatus.COMPLETED)
            self.provider.purge()
            second = service.create_task(23, requested_quality="1080p")
            service.process_task(second.task_id)
            second = repository.get_by_id(second.task_id)
            self.assertEqual(second.status, IngestStatus.COMPLETED)
            self.assertNotEqual(first.result_url, second.result_url)
            self.assertTrue(IngestService._cdn_alive(second.result_url))
        # Restored tiny quota: oversize rejection follows the existing fallback.
        third = service.create_task(24)
        service.process_task(third.task_id)
        third = repository.get_by_id(third.task_id)
        self.assertEqual(third.status, IngestStatus.STREAMING)
        self.assertTrue(third.cache_failed)
        self.assertFalse(third.result_url)

    def client(self):
        from app.api.routes import router
        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def test_http_ranges_head_missing_and_auth(self):
        result = self.upload(b"0123456789")
        url = f"/api/v1/media/files/{result.file_id}"
        client = self.client()
        auth = {"X-Evo-Secret": "s3cret"}
        self.assertEqual(client.get(url).status_code, 401)
        for value, body, content_range in (("bytes=2-5", b"2345", "bytes 2-5/10"), ("bytes=6-", b"6789", "bytes 6-9/10"), ("bytes=-3", b"789", "bytes 7-9/10"), ("bytes=8-100", b"89", "bytes 8-9/10"), ("bytes=-100", b"0123456789", "bytes 0-9/10")):
            response = client.get(url, headers={**auth, "Range": value})
            self.assertEqual(response.status_code, 206)
            self.assertEqual(response.content, body)
            self.assertEqual(response.headers["content-range"], content_range)
            self.assertEqual(int(response.headers["content-length"]), len(body))
            self.assertEqual(response.headers["accept-ranges"], "bytes")
        for value in ("bytes=10-", "bytes=7-2", "bytes=-0", "bytes=-", "bytes=0-2,4-5", "nope"):
            response = client.get(url, headers={**auth, "Range": value})
            self.assertEqual(response.status_code, 416, value)
            self.assertEqual(response.headers["content-range"], "bytes */10")
        response = client.head(url, headers=auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"")
        self.assertEqual(response.headers["content-length"], "10")
        self.assertEqual(response.headers["content-type"], "video/mp4")
        self.assertFalse(self.provider.pins)
        self.provider.purge()
        self.assertEqual(client.get(url, headers=auth).status_code, 404)
        self.assertEqual(client.get("/api/v1/media/files/not-an-id", headers=auth).status_code, 400)

    def test_if_range_and_other_content_types(self):
        client, auth = self.client(), {"X-Evo-Secret": "s3cret"}
        for ext, mime in (("mkv", "video/x-matroska"), ("vtt", "text/vtt")):
            result = self.upload(b"abc", ext)
            url = f"/api/v1/media/files/{result.file_id}"
            response = client.get(url, headers=auth)
            self.assertEqual(response.headers["content-type"], mime)
            etag = response.headers["etag"]
            self.assertEqual(client.get(url, headers={**auth, "Range": "bytes=1-", "If-Range": etag}).status_code, 206)
            stale = client.get(url, headers={**auth, "Range": "bytes=1-", "If-Range": '"stale"'})
            self.assertEqual(stale.status_code, 200)
            self.assertEqual(stale.content, b"abc")

    def test_response_pin_survives_until_disconnect_and_prevents_eviction(self):
        result = self.upload(b"x" * 10)
        request = Request({"type": "http", "method": "GET", "headers": []})
        response = file_response(result.file_id, request)
        with self.assertRaises(RuntimeError):
            self.upload()

        async def send(message):
            if message["type"] == "http.response.body":
                self.assertTrue(self.provider.pins.get(result.file_id))
                self.assertEqual(self.provider.purge()["deleted"], 0)
                raise OSError("viewer disconnected")

        async def receive():
            await asyncio.Event().wait()

        async def run():
            try:
                await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)
            except Exception:
                pass  # StreamingResponse turns disconnects into ClientDisconnect.

        asyncio.run(run())
        self.assertFalse(self.provider.pins)
        self.assertEqual(self.provider.purge()["deleted"], 1)

    def test_local_admin_files_usage_purge_and_pixeldrain_only_conflicts(self):
        result = self.upload()
        client, auth = self.client(), {"X-Evo-Secret": "s3cret"}
        base = "/api/v1/media/cdn"
        self.assertEqual(client.get(base + "/files", headers=auth).json()[0]["url"], result.direct_url)
        self.assertEqual(client.get(base + "/local/usage", headers=auth).json()["videos"]["file_count"], 1)
        for path in ("/user", "/albums", "/albums/test"):
            self.assertEqual(client.get(base + path, headers=auth).status_code, 409)
        self.assertEqual(client.post(base + "/delete", headers=auth, json={"url": result.direct_url}).status_code, 200)
        results = [self.upload(), self.upload()]
        batch = client.post(base + "/delete-many", headers=auth, json={"urls": [r.direct_url for r in results] + ["evo-local://../x"]}).json()
        self.assertEqual(len(batch["deleted"]), 2)
        self.assertEqual(len(batch["failed"]), 1)
        self.upload()
        self.assertEqual(client.post(base + "/local/purge", headers=auth).json()["deleted"], 1)

    def test_runtime_config_validation_and_serialization(self):
        self.assertEqual(runtime_config.coerce("CDN_PROVIDER", "local"), "local")
        self.assertEqual(runtime_config.coerce("LOCAL_CDN_DIR", "/mnt/cdn"), "/mnt/cdn")
        for key, value in (("CDN_PROVIDER", "s3"), ("LOCAL_CDN_DIR", ""), ("LOCAL_CDN_VIDEO_GB", -1), ("LOCAL_CDN_SUBTITLE_GB", float("inf"))):
            with self.assertRaises(ValueError):
                runtime_config.coerce(key, value)
        spec = next(s for s in runtime_config.snapshot({}) if s["key"] == "LOCAL_CDN_DIR")
        self.assertIsInstance(spec["value"], str)
        self.assertIsInstance(spec["default"], str)

    def test_local_translation_source_validation_and_read_without_http(self):
        with mock.patch.object(settings, "LOCAL_CDN_SUBTITLE_GB", 1):
            vtt = "WEBVTT\n\n" + "\n\n".join(f"{i+1}\n00:{i:02}:00.000 --> 00:{i:02}:02.000\nHello there" for i in range(50))
            source = self.upload(vtt.encode(), "vtt")
        track_id = str(uuid.uuid4())
        request = SinhalaSubtitleRequest(tmdb_id=1, source_track_id=track_id, source_url=source.direct_url)
        self.assertEqual(request.source_url, source.direct_url)
        for bad in ("evo-local://../secret.vtt", "evo-local://" + "a" * 32 + ".mp4", "evo-local://" + "a" * 32 + ".vtt?x", "https://example.com/source.vtt"):
            with self.assertRaises(ValidationError):
                SinhalaSubtitleRequest(tmdb_id=1, source_track_id=track_id, source_url=bad)
        subtitles = SubtitleService(self.root / "subs")
        subtitles._meta_cache["local_test"] = {"dl_link": source.direct_url}
        with mock.patch("app.services.subtitle_service.requests.Session") as http:
            self.assertIn("Hello there", subtitles.get_vtt("local_test"))
            http.assert_not_called()
        self.assertFalse(self.provider.pins)
