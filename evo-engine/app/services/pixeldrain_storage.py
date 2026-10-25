import logging
import urllib.parse
from pathlib import Path
from typing import Callable, Optional

import requests
from app.interfaces.contracts import IStorageProvider
from app.domain.models import UploadResult

logger = logging.getLogger("evo.storage")


class ProgressReader:
    def __init__(self, path: Path, callback: Optional[Callable[[int], None]] = None):
        self.path = path
        self.total = path.stat().st_size
        self._f = open(path, "rb")
        self.read_bytes = 0
        self.last_pct = -1
        self.callback = callback

    def read(self, size=-1):
        chunk = self._f.read(size)
        if chunk:
            self.read_bytes += len(chunk)
            pct = int(self.read_bytes * 100 / self.total) if self.total else 100
            if pct != self.last_pct and pct % 5 == 0:
                self.last_pct = pct
                if self.callback:
                    self.callback(pct)
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self._f.close()


class PixeldrainStorageProvider(IStorageProvider):
    """Storage provider implementation for Pixeldrain CDN."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://pixeldrain.com/api/file"

    def upload_file(
        self,
        file_path: Path,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> UploadResult:
        if not file_path.exists():
            raise FileNotFoundError(f"File not found for upload: {file_path}")

        file_name = file_path.name
        file_size = file_path.stat().st_size
        logger.info(f"Uploading {file_name} ({file_size / (1024*1024):.1f} MB) to Pixeldrain...")

        url = f"{self.base_url}/{urllib.parse.quote(file_name)}"
        with ProgressReader(file_path, callback=progress_callback) as reader:
            resp = requests.put(
                url,
                data=reader,
                auth=("", self.api_key) if self.api_key else None,
                timeout=(30, 7200),
            )

        if resp.status_code != 201:
            raise RuntimeError(f"Pixeldrain upload failed: HTTP {resp.status_code} - {resp.text}")

        file_id = resp.json().get("id")
        direct_url = f"https://pixeldrain.com/api/file/{file_id}"
        logger.info(f"Pixeldrain upload succeeded: {direct_url}")

        return UploadResult(
            storage_provider="pixeldrain",
            file_id=file_id,
            direct_url=direct_url,
            size_bytes=file_size,
        )

    def _auth(self):
        return ("", self.api_key) if self.api_key else None

    def delete_file(self, file_id: str) -> None:
        """Deletes a file from the Pixeldrain account. A file that is already gone counts as deleted."""
        resp = requests.delete(f"{self.base_url}/{urllib.parse.quote(file_id)}", auth=self._auth(), timeout=30)
        if resp.status_code not in (200, 404):
            raise RuntimeError(f"Pixeldrain delete failed: HTTP {resp.status_code} - {resp.text[:200]}")

    def list_files(self) -> list:
        """Files in the Pixeldrain account (needs the API key)."""
        if not self.api_key:
            raise RuntimeError("PIXELDRAIN_API_KEY is not set")
        resp = requests.get("https://pixeldrain.com/api/user/files", auth=self._auth(), timeout=30)
        if resp.status_code != 200:
            raise RuntimeError(f"Pixeldrain list failed: HTTP {resp.status_code}")
        return resp.json().get("files", [])
