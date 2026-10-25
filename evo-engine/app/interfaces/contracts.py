from abc import ABC, abstractmethod
from pathlib import Path
from typing import List, Callable, Optional
from app.domain.models import StreamSource, UploadResult


class IStreamExtractor(ABC):
    """Interface for extracting and decrypting streams from external media providers."""

    @abstractmethod
    def extract_streams(
        self,
        tmdb_id: int,
        media_type: str = "movie",
        season: Optional[int] = None,
        episode: Optional[int] = None,
    ) -> List[StreamSource]:
        """Extracts playable master stream URLs."""
        pass


class IMediaDownloader(ABC):
    """Interface for downloading and remuxing video streams."""

    @abstractmethod
    def download_stream(
        self,
        stream: StreamSource,
        output_path: Path,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> Path:
        """Downloads stream to local file using remuxing."""
        pass


class IStorageProvider(ABC):
    """Interface for CDN and file storage providers (e.g. Pixeldrain, Cloudflare R2, S3)."""

    @abstractmethod
    def upload_file(
        self,
        file_path: Path,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> UploadResult:
        """Uploads a local media file to cloud storage/CDN."""
        pass
