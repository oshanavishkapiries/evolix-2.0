"""On-disk cache of the YtHD decryptor script (vsdec.js), keyed by the version the player page references.

Survives restarts, is pruned to the newest few versions, and is refreshed only when the version changes or a
decryption with the cached copy fails (the caller asks for `refresh` once and retries).
"""
import logging
import re
import time
from pathlib import Path
from typing import Callable, Tuple

from app.core.config import settings
from app.core.notes import note

logger = logging.getLogger("evo.decryptor_cache")

# Used when the player page does not name a version (the provider's last known value).
FALLBACK_VERSION = "1786492668"
KEEP_VERSIONS = 3
_VERSION_RX = re.compile(r"vsdec\.js\?v=([\w.-]+)")


def version_from_page(html: str) -> str:
    m = _VERSION_RX.search(html or "")
    return m.group(1) if m else FALLBACK_VERSION


class DecryptorCache:
    def __init__(self, directory: Path, keep: int = KEEP_VERSIONS):
        self.dir = directory
        self.keep = keep

    def _path(self, version: str) -> Path:
        return self.dir / f"vsdec-{re.sub(r'[^\w.-]', '_', version)}.js"

    def get(self, url_for: Callable[[str], str], version: str, fetch: Callable[[str], str]) -> Tuple[str, bool]:
        """Returns (script, from_cache). `url_for(version)` builds the download URL, `fetch(url)` downloads it."""
        path = self._path(version)
        if settings.YTHD_DECRYPTOR_CACHE and path.exists() and path.stat().st_size > 0:
            note(f"YtHD decryptor v{version}: cache hit")
            path.touch()
            return path.read_text(encoding="utf-8"), True
        return self._download(url_for, version, fetch, "fetched and cached"), False

    def refresh(self, url_for: Callable[[str], str], version: str, fetch: Callable[[str], str]) -> str:
        return self._download(url_for, version, fetch, "refreshed after a failed decryption")

    def _download(self, url_for: Callable[[str], str], version: str, fetch: Callable[[str], str], what: str) -> str:
        text = fetch(url_for(version))
        if not text or not text.strip():
            raise RuntimeError("The decryptor download was empty")
        note(f"YtHD decryptor v{version}: {what}")
        if settings.YTHD_DECRYPTOR_CACHE:
            self.dir.mkdir(parents=True, exist_ok=True)
            tmp = self._path(version).with_suffix(".tmp")
            tmp.write_text(text, encoding="utf-8")
            tmp.replace(self._path(version))  # atomic: a crash never leaves half a script
            self._prune(version)
        return text

    def _prune(self, current: str) -> None:
        files = sorted(self.dir.glob("vsdec-*.js"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in files[self.keep:]:
            if old != self._path(current):
                old.unlink(missing_ok=True)
