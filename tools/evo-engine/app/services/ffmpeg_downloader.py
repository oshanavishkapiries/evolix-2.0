import logging
import subprocess
from pathlib import Path
from typing import Callable, Optional

from app.interfaces.contracts import IMediaDownloader
from app.domain.models import StreamSource

logger = logging.getLogger("evo.downloader")


class FFmpegStreamDownloader(IMediaDownloader):
    """Lossless HLS stream downloader that remuxes .ts chunks directly to .mp4

    using FFmpeg without CPU-heavy re-encoding.
    """

    def __init__(self, ffmpeg_bin: str = "ffmpeg"):
        self.ffmpeg_bin = ffmpeg_bin

    def download_stream(
        self,
        stream: StreamSource,
        output_path: Path,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)

        headers_str = ""
        for k, v in stream.headers.items():
            headers_str += f"{k}: {v}\r\n"

        cmd = [
            self.ffmpeg_bin,
            "-y",
            "-headers",
            headers_str,
            "-i",
            stream.url,
            "-c",
            "copy",
            "-bsf:a",
            "aac_adtstoasc",
            str(output_path),
        ]

        logger.info(f"Starting FFmpeg remux: {' '.join(cmd[:6])} -> {output_path.name}")
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        _, stderr = process.communicate()

        if process.returncode != 0:
            logger.error(f"FFmpeg failed with return code {process.returncode}: {stderr[-400:]}")
            raise RuntimeError(f"FFmpeg download failed with exit code {process.returncode}")

        if progress_callback:
            progress_callback(100)

        logger.info(f"Download complete: {output_path.name} ({output_path.stat().st_size / (1024*1024):.1f} MB)")
        return output_path
