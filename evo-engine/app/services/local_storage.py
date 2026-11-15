"""Quota-controlled local CDN. One shared instance per directory owns its index and pins.

Uploads reserve quota under a short lock, then copy concurrently without blocking
readers. Readers hold pins until their response closes; access writes are throttled.
The SQLite index is reconciled once at startup, including recovery after a crash
between atomic publication and index commit. No playback request scans directories.
"""
import os
import re
import shutil
import sqlite3
import threading
import time
import uuid
from pathlib import Path

from app.core.config import settings
from app.domain.models import UploadResult
from app.interfaces.contracts import IStorageProvider

FILE_ID = re.compile(r"^[a-f0-9]{32,64}\.[a-z0-9]{1,10}$")


def validate_file_id(file_id):
    if not isinstance(file_id, str) or not FILE_ID.fullmatch(file_id):
        raise ValueError("Invalid local CDN file id")
    return file_id


class LocalDiskStorageProvider(IStorageProvider):
    def __init__(self, directory=None):
        self.directory = Path(directory or settings.LOCAL_CDN_DIR).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.pins = {}
        self.reserved = {"videos": 0, "subtitles": 0}
        self.space_available = threading.Condition(self.lock)
        self.last_touch = {}
        self.db = sqlite3.connect(self.directory / "index.sqlite3", check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, pool TEXT, size INTEGER, accessed REAL, uploaded REAL)")
        self.db.execute("CREATE INDEX IF NOT EXISTS files_lru ON files(pool, accessed)")
        # Disk is authoritative after interrupted uploads/deletions. Only run once.
        self.db.execute("DELETE FROM files")
        for pool in ("videos", "subtitles"):
            folder = self.directory / pool
            folder.mkdir(exist_ok=True)
            for path in folder.iterdir():
                if path.name.endswith(".tmp"):
                    path.unlink(missing_ok=True)
                elif FILE_ID.fullmatch(path.name) and path.is_file() and not path.is_symlink():
                    st = path.stat()
                    self.db.execute("INSERT INTO files VALUES (?,?,?,?,?)", (path.name, pool, st.st_size, st.st_mtime, st.st_ctime))
        self.db.commit()

    def _pool(self, file_id):
        return "subtitles" if file_id.endswith(".vtt") else "videos"

    def _path(self, file_id):
        validate_file_id(file_id)
        return self.directory / self._pool(file_id) / file_id

    def _quota(self, pool):
        gb = settings.LOCAL_CDN_SUBTITLE_GB if pool == "subtitles" else settings.LOCAL_CDN_VIDEO_GB
        return max(0, int(gb * 1024**3))

    def _delete(self, file_id):
        if self.pins.get(file_id):
            raise RuntimeError("Local CDN file is currently being served")
        self._path(file_id).unlink(missing_ok=True)
        self.db.execute("DELETE FROM files WHERE id=?", (file_id,))
        self.db.commit()
        self.last_touch.pop(file_id, None)

    def upload_file(self, file_path, progress_callback=None):
        file_path = Path(file_path)
        size = file_path.stat().st_size
        ext = file_path.suffix.lower().lstrip(".")
        if not re.fullmatch(r"[a-z0-9]{1,10}", ext):
            raise ValueError("Local CDN requires a safe file extension")
        file_id = f"{uuid.uuid4().hex}.{ext}"
        pool = self._pool(file_id)
        path = self._path(file_id)
        temporary = path.with_name(file_id + ".tmp")
        with self.space_available:
            while True:
                quota = self._quota(pool)
                if size > quota:
                    raise ValueError(f"File size {size} exceeds local CDN {pool} quota {quota}")
                used = self.db.execute("SELECT COALESCE(SUM(size),0) FROM files WHERE pool=?", (pool,)).fetchone()[0]
                candidates = self.db.execute("SELECT id,size FROM files WHERE pool=? ORDER BY accessed,id", (pool,)).fetchall()
                removable = [(fid, n) for fid, n in candidates if not self.pins.get(fid)]
                if used + self.reserved[pool] + size - sum(n for _, n in removable) <= quota:
                    break
                if not self.reserved[pool]:
                    raise RuntimeError("Local CDN quota is occupied by files currently being served")
                # Wait for in-flight uploads, releasing the lock so playback and
                # publication continue. Recheck quotas and pins after waking.
                self.space_available.wait()
            for fid, n in removable:
                if used + self.reserved[pool] + size <= quota:
                    break
                self._delete(fid)
                used -= n
            # Reservations conservatively cover the still-unwritten portion of
            # all concurrent copies, including those in the other quota pool.
            if shutil.disk_usage(self.directory).free - sum(self.reserved.values()) - size < settings.MIN_FREE_DISK_GB * 1024**3:
                raise RuntimeError("Insufficient free disk for local CDN (MIN_FREE_DISK_GB)")
            self.reserved[pool] += size
        reserved = True
        try:
            # Slow I/O must never hold the playback/index lock.
            with file_path.open("rb") as source, temporary.open("xb") as target:
                shutil.copyfileobj(source, target, 1024 * 1024)
                target.flush()
                os.fsync(target.fileno())
            if temporary.stat().st_size != size:
                raise RuntimeError("Source file changed during local CDN upload")
            now = time.time()
            os.utime(temporary, (now, now))
            with self.space_available:
                try:
                    os.replace(temporary, path)
                    self.db.execute("INSERT INTO files VALUES (?,?,?,?,?)", (file_id, pool, size, now, now))
                    self.db.commit()
                except BaseException:
                    self.db.rollback()
                    path.unlink(missing_ok=True)
                    raise
                # Atomically convert reserved bytes into indexed bytes, so no
                # other upload can double-count or overshoot this pool.
                self.reserved[pool] -= size
                reserved = False
                self.space_available.notify_all()
            directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            try:
                temporary.unlink(missing_ok=True)
            finally:
                with self.space_available:
                    if reserved:
                        self.reserved[pool] -= size
                    self.space_available.notify_all()
        if progress_callback:
            progress_callback(100)
        return UploadResult(storage_provider="local", file_id=file_id, direct_url=f"evo-local://{file_id}", size_bytes=size)

    def exists(self, file_id):
        with self.lock:
            path = self._path(file_id)
            return not path.is_symlink() and path.is_file()

    def open_file(self, file_id, *, touch=True):
        with self.lock:
            path = self._path(file_id)
            if path.is_symlink():
                raise FileNotFoundError(file_id)
            handle = path.open("rb")
            self.pins[file_id] = self.pins.get(file_id, 0) + 1
            try:
                if touch:
                    self.touch(file_id)
                return handle
            except BaseException:
                self.close_file(file_id, handle)
                raise

    def touch(self, file_id):
        with self.lock:
            tick = time.monotonic()
            previous = self.last_touch.get(file_id)
            if previous is not None and tick - previous < 60:
                return
            now = time.time()
            os.utime(self._path(file_id), (now, now))
            self.db.execute("UPDATE files SET accessed=? WHERE id=?", (now, file_id))
            self.db.commit()
            self.last_touch[file_id] = tick

    def close_file(self, file_id, handle):
        with self.lock:
            handle.close()
            count = self.pins.get(file_id, 0) - 1
            if count > 0:
                self.pins[file_id] = count
            else:
                self.pins.pop(file_id, None)

    def delete_file(self, file_id):
        with self.lock:
            self._delete(validate_file_id(file_id))

    def list_files(self):
        with self.lock:
            return [{"id": fid, "name": fid, "size": size, "date_upload": uploaded, "last_access": accessed,
                     "url": f"evo-local://{fid}"} for fid, size, uploaded, accessed in
                    self.db.execute("SELECT id,size,uploaded,accessed FROM files ORDER BY accessed DESC").fetchall()]

    def usage(self):
        with self.lock:
            result = {}
            for pool in ("videos", "subtitles"):
                used, count, oldest = self.db.execute("SELECT COALESCE(SUM(size),0),COUNT(*),MIN(accessed) FROM files WHERE pool=?", (pool,)).fetchone()
                result[pool] = {"used_bytes": used, "quota_bytes": self._quota(pool), "file_count": count, "oldest": oldest}
            return result

    def purge(self):
        with self.lock:
            deleted = 0
            for (fid,) in self.db.execute("SELECT id FROM files").fetchall():
                if not self.pins.get(fid):
                    self._delete(fid)
                    deleted += 1
            return {"deleted": deleted, "pinned": len(self.pins), "usage": self.usage()}
