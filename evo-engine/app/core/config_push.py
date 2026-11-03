"""App-managed configuration and encrypted transport, independent of FastAPI.

SQLite holds the wire payload; only settings and this process's desired-state map
contain decrypted secrets. A lock serializes pushes and legacy admin mutations.
"""
import base64
import logging
import re
import threading

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings
from app.core import runtime_config as runtime

SALT = b"evolix-engine-config-v1"
INFO = b"engine-secrets"
logger = logging.getLogger("evo.config_push")


def derive_key(token: str) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=SALT, info=INFO).derive(token.encode("utf-8"))


def _decode(part: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]*", part):
        raise ValueError("Invalid secret envelope")
    raw = base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
    if base64.urlsafe_b64encode(raw).decode().rstrip("=") != part:
        raise ValueError("Invalid secret envelope")
    return raw


def decrypt_secret(envelope: str, token: str) -> str:
    try:
        prefix, version, iv, tag, ciphertext = envelope.split(":")
        if prefix != "enc" or version != "v1":
            raise ValueError()
        iv, tag, ciphertext = _decode(iv), _decode(tag), _decode(ciphertext)
        if len(iv) != 12 or len(tag) != 16 or not token:
            raise ValueError()
        return AESGCM(derive_key(token)).decrypt(iv, ciphertext + tag, None).decode("utf-8")
    except Exception:
        # Do not include envelopes, crypto exceptions or plaintext in API/logs.
        raise ValueError("Invalid secret envelope or engine token") from None


def validate_state(values, secrets, token: str, *, skip_bad_secrets=False) -> dict:
    if not isinstance(values, dict) or not isinstance(secrets, dict):
        raise ValueError("values and secrets must be objects")
    for entries, secret in ((values, False), (secrets, True)):
        for key in entries:
            spec = runtime.BY_KEY.get(key)
            if spec is None or (spec.kind == "secret") != secret:
                raise ValueError("Unknown setting or incorrect values/secrets section")
    clean = {key: runtime.coerce(key, value) for key, value in values.items()}
    for key, envelope in secrets.items():
        try:
            clean[key] = runtime.coerce(key, decrypt_secret(envelope, token))
        except ValueError:
            if not skip_bad_secrets:
                raise
            logger.warning("Could not decrypt cached %s; using environment fallback (engine token may have changed)", key)
    return clean


class StaleVersion(ValueError):
    def __init__(self, version):
        self.version = version
        super().__init__("stale")


class ConfigPush:
    def __init__(self, repository, on_apply=lambda: None):
        self.repository = repository
        self.on_apply = on_apply
        self.lock = threading.RLock()
        self.version = 0
        self.managed = False
        self.overrides = {}
        self.desired = dict(runtime.DEFAULTS)
        self.running = {key: getattr(settings, key) for key in runtime.BY_KEY}
        self.restart_needed = []

    def status(self):
        with self.lock:
            return {"config_version": self.version, "restart_needed": list(self.restart_needed), "config_managed": self.managed}

    def snapshot(self):
        with self.lock:
            if not self.managed:
                return runtime.snapshot(self.repository.get_config())
            return runtime.snapshot(self.overrides, managed=True, restart_needed=self.restart_needed, desired=self.desired)

    def _apply(self, clean, *, startup=False):
        self.overrides = clean
        self.desired = {**runtime.DEFAULTS, **clean}
        applied = []
        for key, value in self.desired.items():
            if startup or runtime.BY_KEY[key].live:
                if getattr(settings, key) != value:
                    applied.append(key)
                runtime.apply(key, value)
        if startup:
            self.running = dict(self.desired)
        self.restart_needed = sorted(key for key, value in self.desired.items()
                                     if not runtime.BY_KEY[key].live and value != self.running[key])
        self.on_apply()
        return sorted(applied)

    def load(self):
        """Load cached full state without network; only never-managed engines use legacy overrides."""
        with self.lock:
            cached = self.repository.get_pushed_config()
            if cached is not None:
                clean = validate_state(cached["values"], cached["secrets"], settings.EVO_SECRET_TOKEN, skip_bad_secrets=True)
                self._apply(clean, startup=True)
                self.version, self.managed = cached["version"], True
            else:
                for key, value in self.repository.get_config().items():
                    if key in runtime.BY_KEY:
                        runtime.apply(key, value)
                self.running = {key: getattr(settings, key) for key in runtime.BY_KEY}
                self.on_apply()

    def accept(self, payload):
        with self.lock:
            if not isinstance(payload, dict):
                raise ValueError("Push must be an object")
            version = payload.get("version")
            if isinstance(version, bool) or not isinstance(version, int) or version < 1 or version > 2**53 - 1:
                raise ValueError("version must be a positive safe integer")
            if version < self.version:
                raise StaleVersion(self.version)
            if version == self.version and self.managed:
                return self._response([])
            if set(payload) != {"version", "values", "secrets"}:
                raise ValueError("Push requires version, values and secrets")
            clean = validate_state(payload["values"], payload["secrets"], settings.EVO_SECRET_TOKEN)
            # Persistence completes before changing the live process. Validation of
            # the entire full state precedes either operation.
            self.repository.save_pushed_config(version, payload["values"], payload["secrets"])
            applied = self._apply(clean)
            self.version, self.managed = version, True
            return self._response(applied)

    def _response(self, applied):
        return {"version": self.version, "applied": applied, "restart_needed": list(self.restart_needed), "managed": self.managed}
