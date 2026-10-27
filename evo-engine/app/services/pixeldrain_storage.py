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

    # ---- account and albums (Pixeldrain "lists"); every call needs the API key ----

    def _need_key(self) -> None:
        if not self.api_key:
            raise RuntimeError("PIXELDRAIN_API_KEY is not set")

    def _call(self, method: str, path: str, ok: tuple = (200,), **kw):
        self._need_key()
        resp = requests.request(method, f"https://pixeldrain.com/api{path}", auth=self._auth(), timeout=30, **kw)
        if resp.status_code not in ok:
            raise RuntimeError(f"Pixeldrain {method} {path} failed: HTTP {resp.status_code} - {resp.text[:200]}")
        return resp.json() if resp.content else {}

    def user_info(self) -> dict:
        """Account, subscription, storage used and bandwidth numbers."""
        return self._call("GET", "/user")

    def list_albums(self) -> list:
        return self._call("GET", "/user/lists").get("lists", [])

    def get_album(self, list_id: str) -> dict:
        return self._call("GET", f"/list/{urllib.parse.quote(list_id)}")

    def create_album(self, title: str, file_ids: list) -> str:
        data = self._call("POST", "/list", ok=(200, 201), json={"title": title, "anonymous": False, "files": [{"id": i} for i in file_ids]})
        return data.get("id", "")

    def update_album(self, list_id: str, title: Optional[str], add: list, remove: list) -> dict:
        """Renames an album and/or adds and removes files (Pixeldrain replaces the whole file list on update)."""
        current = self.get_album(list_id)
        ids = [f["id"] for f in current.get("files", []) if isinstance(f, dict) and f.get("id")]
        drop = set(remove)
        ids = [i for i in ids if i not in drop] + [i for i in add if i not in ids]
        self._call("PUT", f"/list/{urllib.parse.quote(list_id)}", json={"title": title or current.get("title", "Album"), "files": [{"id": i} for i in ids]})
        return {"id": list_id, "files": len(ids)}

    def delete_album(self, list_id: str) -> None:
        self._call("DELETE", f"/list/{urllib.parse.quote(list_id)}", ok=(200, 404))
