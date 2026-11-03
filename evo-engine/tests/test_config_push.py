"""Configuration pushes are offline, full-state, encrypted, and backward compatible."""
import base64
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException

from app.core.config import settings
from app.core import runtime_config as runtime
from app.core.config_push import ConfigPush, StaleVersion, derive_key, decrypt_secret, SALT, INFO
from app.services.sqlite_repository import SQLiteTaskRepository

TOKEN = "test-engine-token-α"
SECRET = "unit-test-secret-never-on-disk-5678"
VECTOR = Path(__file__).parent / "vectors" / "engine_config_crypto.json"


def encrypt(plaintext=SECRET, token=TOKEN, iv=bytes(range(12))):
    data = AESGCM(derive_key(token)).encrypt(iv, plaintext.encode(), None)
    b64 = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
    return f"enc:v1:{b64(iv)}:{b64(data[-16:])}:{b64(data[:-16])}"


class Crypto(unittest.TestCase):
    def test_cross_language_vector(self):
        vector = json.loads(VECTOR.read_text())
        self.assertEqual(vector["salt"], SALT.decode())
        self.assertEqual(vector["info"], INFO.decode())
        self.assertEqual(derive_key(vector["token"]).hex(), vector["derived_key_hex"])
        self.assertEqual(encrypt(vector["plaintext"], vector["token"], bytes.fromhex(vector["iv_hex"])), vector["envelope"])
        self.assertEqual(decrypt_secret(vector["envelope"], vector["token"]), vector["plaintext"])

    def test_utf8_and_empty_round_trip(self):
        for value in ("", "රහස🔑", SECRET):
            self.assertEqual(decrypt_secret(encrypt(value), TOKEN), value)

    def test_tampering_wrong_key_and_malformed_envelopes_are_rejected(self):
        envelope = encrypt()
        for invalid, token in ((envelope, "wrong"), (envelope, ""),
                               (envelope[:-3] + "AAA", TOKEN), ("plain secret", TOKEN),
                               (envelope + "=", TOKEN), (envelope.replace("enc:v1", "enc:v2"), TOKEN)):
            with self.subTest(envelope=invalid), self.assertRaisesRegex(ValueError, "Invalid secret"):
                decrypt_secret(invalid, token)


class Push(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=settings.TEMP_DIR)
        self.addCleanup(self.temp.cleanup)
        self.patch = mock.patch.multiple(settings, **{**runtime.DEFAULTS, "EVO_SECRET_TOKEN": TOKEN})
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.repo = SQLiteTaskRepository(Path(self.temp.name) / "config.sqlite3")
        self.callback = mock.Mock()
        self.push = ConfigPush(self.repo, self.callback)

    def accept(self, version=1, values=None, secrets=None):
        return self.push.accept({"version": version, "values": values or {}, "secrets": secrets or {}})

    def test_version_lifecycle(self):
        self.accept(2, {"MAX_CONCURRENT_EXTRACTIONS": 7}, {"OPENROUTER_API_KEY": encrypt()})
        cached = self.repo.get_pushed_config()
        out = self.accept(2, {"UNKNOWN": "ignored on equal"})
        self.assertEqual(out["applied"], [])
        self.assertEqual(self.repo.get_pushed_config(), cached)
        self.assertEqual(settings.MAX_CONCURRENT_EXTRACTIONS, 7)
        with self.assertRaises(StaleVersion) as exc:
            self.accept(1)
        self.assertEqual(exc.exception.version, 2)
        self.accept(3)
        self.assertEqual(settings.MAX_CONCURRENT_EXTRACTIONS, runtime.DEFAULTS["MAX_CONCURRENT_EXTRACTIONS"])
        self.assertEqual(settings.OPENROUTER_API_KEY, runtime.DEFAULTS["OPENROUTER_API_KEY"])
        self.assertEqual(self.push.status()["config_version"], 3)

    def test_validation_is_atomic(self):
        self.accept(values={"MAX_CONCURRENT_EXTRACTIONS": 7})
        before = self.repo.get_pushed_config()
        cases = [({"BOGUS": 3}, {}), ({"EVO_SECRET_TOKEN": "no"}, {}),
                 ({"MAX_CONCURRENT_EXTRACTIONS": 3, "TRANSLATE_CONCURRENCY": 0}, {}),
                 ({"MIN_FREE_DISK_GB": float("nan")}, {}),
                 ({"MAX_CONCURRENT_EXTRACTIONS": True}, {}),
                 ({"MAX_CONCURRENT_EXTRACTIONS": 10**1000}, {}),
                 ({"EVO_WEBHOOK_URL": "file:///tmp/secret"}, {}),
                 ({"OPENROUTER_API_KEY": SECRET}, {}),
                 ({}, {"MAX_CONCURRENT_EXTRACTIONS": encrypt()}),
                 ({"MAX_CONCURRENT_EXTRACTIONS": 3}, {"OPENROUTER_API_KEY": "broken"})]
        for values, secrets in cases:
            with self.subTest(keys=list(values) + list(secrets)), self.assertRaises(ValueError):
                self.accept(2, values, secrets)
            self.assertEqual(self.repo.get_pushed_config(), before)
            self.assertEqual(settings.MAX_CONCURRENT_EXTRACTIONS, 7)
        for version in (0, -1, True, 1.5, "2", 2**53):
            with self.assertRaises(ValueError):
                self.accept(version)

    def test_absent_secret_and_value_restore_original_env_fallback(self):
        with mock.patch.dict(runtime.DEFAULTS, {"OPENROUTER_API_KEY": "fake-env-fallback-abcd", "MAX_CONCURRENT_EXTRACTIONS": 3}):
            self.accept(1, {"MAX_CONCURRENT_EXTRACTIONS": 7}, {"OPENROUTER_API_KEY": encrypt()})
            self.accept(2)
            self.assertEqual(settings.OPENROUTER_API_KEY, "fake-env-fallback-abcd")
            self.assertEqual(settings.MAX_CONCURRENT_EXTRACTIONS, 3)
            snapshot = {entry["key"]: entry for entry in self.push.snapshot()}
            self.assertEqual(snapshot["OPENROUTER_API_KEY"]["source"], "env")
            self.assertEqual(snapshot["OPENROUTER_API_KEY"]["value"], "••••abcd")
            self.assertNotIn("fake-env-fallback-abcd", json.dumps(snapshot))

    def test_persistence_failure_does_not_change_live_state(self):
        with mock.patch.object(self.repo, "save_pushed_config", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.accept(values={"MAX_CONCURRENT_EXTRACTIONS": 7})
        self.assertEqual(settings.MAX_CONCURRENT_EXTRACTIONS, runtime.DEFAULTS["MAX_CONCURRENT_EXTRACTIONS"])
        self.assertFalse(self.push.managed)
        self.assertIsNone(self.repo.get_pushed_config())

    def test_restart_needed_tracks_actual_running_value_until_restart(self):
        old = settings.CLEAN_ORPHANS_ON_START
        desired = not old
        result = self.accept(values={"CLEAN_ORPHANS_ON_START": desired, "BROWSER_POOL_SIZE": 5})
        self.assertEqual(result["restart_needed"], ["CLEAN_ORPHANS_ON_START"])
        self.assertIn("BROWSER_POOL_SIZE", result["applied"])
        self.assertNotIn("CLEAN_ORPHANS_ON_START", result["applied"])
        self.assertEqual(settings.CLEAN_ORPHANS_ON_START, old)
        self.accept(2, {"CLEAN_ORPHANS_ON_START": desired})
        self.assertEqual(self.accept(2)["restart_needed"], ["CLEAN_ORPHANS_ON_START"])
        snapshot = {entry["key"]: entry for entry in self.push.snapshot()}
        self.assertEqual(snapshot["CLEAN_ORPHANS_ON_START"]["value"], desired)
        self.assertTrue(snapshot["CLEAN_ORPHANS_ON_START"]["restart_needed"])
        restarted = ConfigPush(self.repo, self.callback)
        restarted.load()
        self.assertEqual(settings.CLEAN_ORPHANS_ON_START, desired)
        self.assertEqual(restarted.status()["restart_needed"], [])
        # Removing a formerly pushed startup value needs another restart.
        self.push = restarted
        self.assertEqual(self.accept(3)["restart_needed"], ["CLEAN_ORPHANS_ON_START"])

    def test_secrets_masked_and_never_persisted_in_plaintext_or_logged(self):
        with mock.patch("app.core.config_push.logger") as logger:
            self.accept(secrets={"OPENROUTER_API_KEY": encrypt()})
        self.assertNotIn(SECRET, str(logger.mock_calls))
        snapshot = self.push.snapshot()
        self.assertNotIn(SECRET, json.dumps(snapshot))
        entry = next(s for s in snapshot if s["key"] == "OPENROUTER_API_KEY")
        self.assertEqual(entry["value"], "••••5678")
        self.assertEqual(entry["source"], "push")
        self.assertEqual(self.repo.get_pushed_config()["secrets"]["OPENROUTER_API_KEY"], encrypt())
        with self.repo._get_connection() as conn:
            self.assertNotIn(SECRET, "\n".join(conn.iterdump()))
        for path in Path(self.temp.name).iterdir():
            self.assertNotIn(SECRET.encode(), path.read_bytes())

    def test_startup_uses_cache_without_app_and_ignores_legacy(self):
        self.repo.set_config("MAX_CONCURRENT_EXTRACTIONS", 8)
        self.accept(values={"MAX_CONCURRENT_EXTRACTIONS": 4}, secrets={"PIXELDRAIN_API_KEY": encrypt()})
        settings.MAX_CONCURRENT_EXTRACTIONS = 1
        settings.PIXELDRAIN_API_KEY = ""
        restarted = ConfigPush(self.repo, self.callback)
        restarted.load()
        self.assertEqual(settings.MAX_CONCURRENT_EXTRACTIONS, 4)
        self.assertEqual(settings.PIXELDRAIN_API_KEY, SECRET)
        self.assertEqual(restarted.status(), {"config_version": 1, "restart_needed": [], "config_managed": True})

    def test_rotated_token_skips_cached_secrets_without_crashing(self):
        self.accept(values={"MAX_CONCURRENT_EXTRACTIONS": 4}, secrets={"PIXELDRAIN_API_KEY": encrypt()})
        settings.EVO_SECRET_TOKEN = "rotated"
        restarted = ConfigPush(self.repo)
        with self.assertLogs("evo.config_push", level="WARNING") as captured:
            restarted.load()
        self.assertNotIn(SECRET, str(captured.output))
        self.assertEqual(settings.PIXELDRAIN_API_KEY, runtime.DEFAULTS["PIXELDRAIN_API_KEY"])
        self.assertEqual(settings.MAX_CONCURRENT_EXTRACTIONS, 4)
        self.assertTrue(restarted.managed)

    def test_legacy_routes_work_before_push_and_conflict_afterwards(self):
        from app.api import routes
        with mock.patch.object(routes, "_repository", self.repo), mock.patch.object(routes, "_config_push", self.push), mock.patch.object(routes._service_instance, "apply_config"):
            self.assertFalse(routes.config_status()["config_managed"])
            routes.update_config({"MAX_CONCURRENT_EXTRACTIONS": 6})
            self.assertEqual(settings.MAX_CONCURRENT_EXTRACTIONS, 6)
            restarted = ConfigPush(self.repo)
            restarted.load()
            self.assertEqual(settings.MAX_CONCURRENT_EXTRACTIONS, 6)
            routes.reset_config("MAX_CONCURRENT_EXTRACTIONS")
            self.assertEqual(settings.MAX_CONCURRENT_EXTRACTIONS, runtime.DEFAULTS["MAX_CONCURRENT_EXTRACTIONS"])
            routes.push_config({"version": 2, "values": {}, "secrets": {}})
            for call in (lambda: routes.update_config({}), lambda: routes.reset_config("UNKNOWN")):
                with self.assertRaises(HTTPException) as exc:
                    call()
                self.assertEqual((exc.exception.status_code, exc.exception.detail), (409, "Managed by the app"))
            stale = routes.push_config({"version": 1, "values": {}, "secrets": {}})
            self.assertEqual(stale.status_code, 409)
            self.assertEqual(json.loads(stale.body), {"detail": "stale", "version": 2})
            with self.assertRaises(HTTPException) as exc:
                routes.push_config({"version": 3, "values": {"BOGUS": 3}, "secrets": {}})
            self.assertEqual(exc.exception.status_code, 422)

    def test_http_auth_push_errors_and_legacy_conflict_shapes(self):
        from fastapi.testclient import TestClient
        from app.api import routes
        from app.main import app
        client = TestClient(app)
        path = "/api/v1/media/config"
        http_token = "test-engine-http-token"
        headers = {"X-Evo-Secret": http_token}
        payload = {"version": 2, "values": {}, "secrets": {"OPENROUTER_API_KEY": encrypt(token=http_token)}}
        with mock.patch.object(settings, "EVO_SECRET_TOKEN", http_token), mock.patch.object(routes, "_config_push", self.push), mock.patch.object(routes, "_repository", self.repo):
            self.assertEqual(client.put(path + "/push", json=payload).status_code, 401)
            accepted = client.put(path + "/push", json=payload, headers=headers)
            self.assertEqual(accepted.status_code, 200)
            self.assertEqual(accepted.json()["version"], 2)
            self.assertNotIn(SECRET, accepted.text)
            stale = client.put(path + "/push", json={**payload, "version": 1}, headers=headers)
            self.assertEqual((stale.status_code, stale.json()), (409, {"detail": "stale", "version": 2}))
            invalid = client.put(path + "/push", json={**payload, "version": 3, "values": {"UNKNOWN": 3}}, headers=headers)
            self.assertEqual(invalid.status_code, 422)
            for response in (client.put(path, json={}, headers=headers), client.delete(path + "/MAX_QUEUED_TASKS", headers=headers)):
                self.assertEqual((response.status_code, response.json()), (409, {"detail": "Managed by the app"}))
            self.assertNotIn(SECRET, client.get(path, headers=headers).text)
            public = client.get("/health")
            self.assertEqual(public.status_code, 200)
            self.assertNotIn(SECRET, public.text)
            self.assertEqual(public.json()["config_version"], 2)

    def test_health_and_queue_preserve_fields_and_include_config_state(self):
        from app.api import routes
        from app.main import health_check
        self.accept(4)
        with mock.patch.object(routes, "_config_push", self.push):
            health = health_check()
            queue = routes.queue_status()
        self.assertEqual(health["status"], "healthy")
        for result in (health, queue):
            for key, value in self.push.status().items():
                self.assertEqual(result[key], value)


class LiveCredentials(unittest.TestCase):
    def test_existing_instances_read_new_api_keys_on_next_call(self):
        from app.services.pixeldrain_storage import PixeldrainStorageProvider
        from app.services.translation_service import SinhalaTranslator
        storage, translator = PixeldrainStorageProvider(), SinhalaTranslator()
        for new in ("old", "new", ""):
            with mock.patch.object(settings, "PIXELDRAIN_API_KEY", new), mock.patch.object(settings, "OPENROUTER_API_KEY", new):
                self.assertEqual(storage._auth(), ("", new) if new else None)
                self.assertEqual(translator.api_key, new)
                self.assertEqual(translator.enabled, bool(new))
        self.assertEqual(PixeldrainStorageProvider("injected").api_key, "injected")
        self.assertEqual(SinhalaTranslator(api_key="injected").api_key, "injected")

    def test_webhook_reads_current_url(self):
        from app.services.webhook import WebhookNotifier
        from types import SimpleNamespace
        task = SimpleNamespace(task_id="t", tmdb_id=1, media_type=SimpleNamespace(value="movie"), season=None, episode=None,
                               title="Test", requested_quality="720p", resolved_quality="720p", result_url="https://cdn/test", cdn_subtitles=[])
        hook = WebhookNotifier()
        with mock.patch("app.services.webhook.requests.post") as post:
            post.return_value.ok = True
            post.return_value.status_code = 200
            with mock.patch.object(settings, "EVO_WEBHOOK_URL", "https://new.invalid/api/evo/complete"):
                hook.notify_completed(task)
            self.assertEqual(post.call_args.args[0], "https://new.invalid/api/evo/complete")

    def test_error_worker_resolves_url_at_send_time(self):
        from app.core import error_reporting
        class StopWorker(Exception):
            pass
        handler = object.__new__(error_reporting.AppErrorHandler)
        handler.q = mock.Mock()
        handler.q.get.side_effect = [{"message": "test"}, StopWorker()]
        with mock.patch.object(settings, "ERROR_REPORT_URL", "https://new.invalid/api/errors"), mock.patch("app.core.error_reporting.requests.post") as post:
            with self.assertRaises(StopWorker):
                handler._worker()
            self.assertEqual(post.call_args.args[0], "https://new.invalid/api/errors")
        with mock.patch.object(settings, "ERROR_REPORT_URL", ""), mock.patch.object(settings, "EVO_WEBHOOK_URL", "https://host.invalid/api/evo/complete"):
            self.assertEqual(error_reporting.errors_endpoint(), "https://host.invalid/api/errors")


if __name__ == "__main__":
    unittest.main()
