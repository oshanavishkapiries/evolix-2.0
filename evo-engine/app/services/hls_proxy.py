import hashlib
import hmac
import logging
import re
import secrets
import urllib.parse
from typing import Optional, Tuple, Iterator
from curl_cffi import requests

from app.core.config import settings
from app.domain.models import IngestTask

logger = logging.getLogger("evo.hls_proxy")


class HlsProxyService:
    """Proxies HLS playlists and media segments from upstream tokenized CDNs."""

    def __init__(self):
        self._session = requests.AsyncSession(impersonate="chrome124", max_clients=200)
        # Child URLs are signed so the segment/variant endpoints can only fetch what a playlist we served pointed at
        # (otherwise they would fetch any URL a caller supplies). Without a shared secret the key is per-process.
        self._key = (settings.EVO_SECRET_TOKEN or secrets.token_hex(32)).encode()

    def sign(self, task_id: str, url: str) -> str:
        return hmac.new(self._key, f"{task_id}|{url}".encode(), hashlib.sha256).hexdigest()[:32]

    def verify(self, task_id: str, url: str, sig: Optional[str]) -> bool:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return False
        return bool(sig) and hmac.compare_digest(self.sign(task_id, url), sig)

    def _child(self, base: str, task_id: str, kind: str, url: str) -> str:
        """Proxy URL for an upstream playlist ("variant.m3u8") or media chunk ("segment")."""
        return f"{base}/{kind}?url={urllib.parse.quote(url)}&sig={self.sign(task_id, url)}"

    QUALITY_PROFILES = {
        "1080p": {"bandwidth": 4500000, "resolution": "1920x1080", "name": "1080p"},
        "720p": {"bandwidth": 2200000, "resolution": "1280x720", "name": "720p"},
        "480p": {"bandwidth": 1100000, "resolution": "854x480", "name": "480p"},
        "360p": {"bandwidth": 650000, "resolution": "640x360", "name": "360p"},
    }

    async def rewrite_master_playlist(
        self,
        task: IngestTask,
        proxy_base_path: str,
    ) -> Optional[str]:
        """Fetches upstream master/variant playlist and rewrites child URLs to route through proxy."""
        # 1. If multiple variants are available, synthesize multi-quality HLS master playlist (720p default first)
        if task.variants and len(task.variants) > 1:
            order = ["720p", "1080p", "480p", "360p"]
            sorted_qualities = [q for q in order if q in task.variants]
            for q in task.variants:
                if q not in sorted_qualities:
                    sorted_qualities.append(q)

            lines = [
                "#EXTM3U",
                "#EXT-X-VERSION:3",
                "#EXT-X-INDEPENDENT-SEGMENTS",
            ]
            for q in sorted_qualities:
                profile = self.QUALITY_PROFILES.get(
                    q.lower(),
                    {"bandwidth": 1800000, "resolution": "1280x720", "name": q},
                )
                variant_target = f"{proxy_base_path}/variant.m3u8?quality={q}"
                lines.append(
                    f'#EXT-X-STREAM-INF:BANDWIDTH={profile["bandwidth"]},RESOLUTION={profile["resolution"]},NAME="{profile["name"]}"'
                )
                lines.append(variant_target)

            return "\n".join(lines) + "\n"

        # 2. Single-stream fallback
        upstream_url = task.upstream_stream_url
        if not upstream_url:
            return None

        headers = task.upstream_headers or {}
        try:
            r = await self._session.get(upstream_url, headers=headers, timeout=10)
            if r.status_code != 200:
                logger.error(f"Failed to fetch upstream playlist ({r.status_code}) from {upstream_url}")
                return None

            origin = f"{urllib.parse.urlsplit(upstream_url).scheme}://{urllib.parse.urlsplit(upstream_url).netloc}"
            lines = r.text.strip().split("\n")
            rewritten_lines = []

            for i in range(len(lines)):
                line = lines[i].strip()
                if not line:
                    continue

                if line.startswith("#"):
                    rewritten_lines.append(line)
                    continue

                # Target URL
                full_url = line if line.startswith("http") else urllib.parse.urljoin(origin, line)

                # Check if next level is a sub-playlist or direct video segment
                if ".m3u8" in line or "/pl/" in line:
                    rewritten_lines.append(self._child(proxy_base_path, task.task_id, "variant.m3u8", full_url))
                else:
                    rewritten_lines.append(self._child(proxy_base_path, task.task_id, "segment", full_url))

            return "\n".join(rewritten_lines) + "\n"
        except Exception as e:
            logger.exception(f"Error rewriting master playlist for task {task.task_id}: {e}")
            return None

    async def rewrite_variant_playlist(
        self,
        variant_url: str,
        task: IngestTask,
        proxy_base_path: str,
    ) -> Optional[str]:
        """Fetches upstream variant playlist and rewrites segment URLs to route through proxy."""
        headers = task.upstream_headers or {}
        try:
            r = await self._session.get(variant_url, headers=headers, timeout=10)
            if r.status_code != 200:
                logger.error(f"Failed to fetch variant playlist ({r.status_code}) from {variant_url}")
                return None

            origin = f"{urllib.parse.urlsplit(variant_url).scheme}://{urllib.parse.urlsplit(variant_url).netloc}"
            lines = r.text.strip().split("\n")
            rewritten_lines = []

            for line in lines:
                line = line.strip()
                if not line:
                    continue

                if line.startswith("#"):
                    # Check for URI in #EXT-X-KEY or #EXT-X-MAP
                    if 'URI="' in line:
                        m = re.search(r'URI="([^"]+)"', line)
                        if m:
                            uri = m.group(1)
                            full_uri = uri if uri.startswith("http") else urllib.parse.urljoin(origin, uri)
                            line = line.replace(f'URI="{uri}"', f'URI="{self._child(proxy_base_path, task.task_id, "segment", full_uri)}"')
                    rewritten_lines.append(line)
                    continue

                full_url = line if line.startswith("http") else urllib.parse.urljoin(origin, line)
                rewritten_lines.append(self._child(proxy_base_path, task.task_id, "segment", full_url))

            return "\n".join(rewritten_lines) + "\n"
        except Exception as e:
            logger.exception(f"Error rewriting variant playlist {variant_url}: {e}")
            return None

    async def fetch_segment(
        self,
        segment_url: str,
        task: IngestTask,
        range_header: Optional[str] = None,
    ) -> Tuple[int, dict, bytes]:
        """Fetches video segment from upstream CDN using engine's session and IP."""
        headers = dict(task.upstream_headers or {})
        if range_header:
            headers["Range"] = range_header

        r = await self._session.get(segment_url, headers=headers, timeout=15)
        content_type = r.headers.get("Content-Type", "video/mp2t")
        return r.status_code, {"Content-Type": content_type}, r.content
