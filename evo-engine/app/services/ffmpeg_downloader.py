import json
import re
import logging
import subprocess
from pathlib import Path
from typing import Callable, Optional

from app.interfaces.contracts import IMediaDownloader
from app.domain.models import StreamSource

logger = logging.getLogger("evo.downloader")


def _reason(stderr: str) -> str:
    """Last line FFmpeg printed, without URLs (they carry stream tokens): "403 Forbidden", "Permission denied", ..."""
    lines = [l.strip() for l in (stderr or "").splitlines() if l.strip()]
    if not lines:
        return ""
    return ": " + re.sub(r"https?://\S+", "<url>", lines[-1])[:160]


# Providers disguise HLS segments as .jpg, .png, .js ... Recent FFmpeg refuses those ("... is not in
# allowed_segment_extensions"); which options exist depends on the build, and an unknown option aborts the run.
_RELAX = (("allowed_segment_extensions", "ALL"), ("allowed_extensions", "ALL"), ("extension_picky", "0"))


def relax_args(hls_help: str) -> list[str]:
    """Input options that let the HLS demuxer read any segment extension, limited to what this FFmpeg build knows."""
    args: list[str] = []
    for name, value in _RELAX:
        if re.search(rf"^\s*-{name}\s", hls_help, re.M):
            args += [f"-{name}", value]
    return args


class FFmpegStreamDownloader(IMediaDownloader):
    """Lossless HLS stream downloader that remuxes .ts chunks directly to .mp4

    using FFmpeg without CPU-heavy re-encoding.
    """

    def __init__(self, ffmpeg_bin: str = "ffmpeg", ffprobe_bin: str = "ffprobe", timeout_seconds: int = 4 * 3600):
        self.ffmpeg_bin = ffmpeg_bin
        self.ffprobe_bin = ffprobe_bin
        self.timeout_seconds = timeout_seconds
        self._relax: Optional[list[str]] = None

    def _hls_relax_args(self) -> list[str]:
        if self._relax is None:
            try:
                out = subprocess.run([self.ffmpeg_bin, "-hide_banner", "-h", "demuxer=hls"], capture_output=True, text=True, timeout=20)
                self._relax = relax_args(out.stdout + out.stderr)
            except Exception as e:
                logger.warning(f"Could not read FFmpeg's HLS options: {e}")
                self._relax = []
            logger.info(f"FFmpeg HLS segment options: {' '.join(self._relax) or 'none'}")
        return self._relax

    def probe_duration(self, path: Path) -> Optional[float]:
        """Container duration in seconds, or None when ffprobe is unavailable or cannot read the file."""
        try:
            out = subprocess.run(
                [self.ffprobe_bin, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
                capture_output=True,
                text=True,
                timeout=60,
            )
            return float(json.loads(out.stdout)["format"]["duration"])
        except Exception as e:
            logger.warning(f"ffprobe failed for {path.name}: {e}")
            return None

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
            "-reconnect",
            "1",
            "-reconnect_streamed",
            "1",
            "-reconnect_delay_max",
            "5",
            *self._hls_relax_args(),
            "-i",
            stream.url,
            "-c",
            "copy",
            "-bsf:a",
            "aac_adtstoasc",
            # moov atom up front: the CDN copy can start playing (and seek) before it has fully downloaded.
            "-movflags",
            "+faststart",
            str(output_path),
        ]

        logger.info(f"Starting FFmpeg remux: {' '.join(cmd[:6])} -> {output_path.name}")
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        try:
            _, stderr = process.communicate(timeout=self.timeout_seconds)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise RuntimeError(f"FFmpeg timed out after {self.timeout_seconds}s")

        if process.returncode != 0:
            logger.error(f"FFmpeg failed with return code {process.returncode}: {stderr[-400:]}")
            raise RuntimeError(f"FFmpeg download failed with exit code {process.returncode}{_reason(stderr)}")

        if progress_callback:
            progress_callback(100)

        logger.info(f"Download complete: {output_path.name} ({output_path.stat().st_size / (1024*1024):.1f} MB)")
        return output_path
