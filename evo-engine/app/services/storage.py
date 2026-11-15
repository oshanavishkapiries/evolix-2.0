"""Live provider selection; local instances are shared so playback pins survive config changes."""
import threading
from pathlib import Path
from app.core.config import settings
from app.interfaces.contracts import IStorageProvider
from app.services.local_storage import LocalDiskStorageProvider
from app.services.pixeldrain_storage import PixeldrainStorageProvider

_lock = threading.RLock()
_local = {}
_pixeldrain = PixeldrainStorageProvider()


def local_storage():
    directory = str(Path(settings.LOCAL_CDN_DIR).resolve())
    with _lock:
        if directory not in _local:
            _local[directory] = LocalDiskStorageProvider(directory)
        return _local[directory]


def selected_storage():
    if settings.CDN_PROVIDER == "local":
        return local_storage()
    if settings.CDN_PROVIDER == "pixeldrain":
        return _pixeldrain
    raise ValueError("CDN_PROVIDER must be pixeldrain or local")


class RuntimeStorageProvider(IStorageProvider):
    def upload_file(self, file_path, progress_callback=None):
        return selected_storage().upload_file(file_path, progress_callback)

    def __getattr__(self, name):
        return getattr(selected_storage(), name)
