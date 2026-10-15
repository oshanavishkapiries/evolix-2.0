import logging
import re
import urllib.parse
from typing import Optional, Tuple, Iterator
from curl_cffi import requests

from app.domain.models import IngestTask

logger = logging.getLogger("evo.hls_proxy")


class HlsProxyService:
    """Proxies HLS playlists and media segments from upstream tokenized CDNs."""

    def __init__(self):
        self._session = requests.Session(impersonate="chrome124")

    def rewrite_master_playlist(
        self,
        task: IngestTask,
        proxy_base_path: str,
    ) -> Optional[str]:
        """Fetches upstream master/variant playlist and rewrites child URLs to route through proxy."""
        upstream_url = task.upstream_stream_url
        if not upstream_url:
            return None

        headers = task.upstream_headers or {}
        try:
            r = self._session.get(upstream_url, headers=headers, timeout=10)
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
                    encoded = urllib.parse.quote(full_url)
                    rewritten_lines.append(f"{proxy_base_path}/variant.m3u8?url={encoded}")
                else:
                    encoded = urllib.parse.quote(full_url)
                    rewritten_lines.append(f"{proxy_base_path}/segment?url={encoded}")

            return "\n".join(rewritten_lines) + "\n"
        except Exception as e:
            logger.exception(f"Error rewriting master playlist for task {task.task_id}: {e}")
            return None

    def rewrite_variant_playlist(
        self,
        variant_url: str,
        task: IngestTask,
        proxy_base_path: str,
    ) -> Optional[str]:
        """Fetches upstream variant playlist and rewrites segment URLs to route through proxy."""
        headers = task.upstream_headers or {}
        try:
            r = self._session.get(variant_url, headers=headers, timeout=10)
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
                            encoded_uri = urllib.parse.quote(full_uri)
                            line = line.replace(f'URI="{uri}"', f'URI="{proxy_base_path}/segment?url={encoded_uri}"')
                    rewritten_lines.append(line)
                    continue

                full_url = line if line.startswith("http") else urllib.parse.urljoin(origin, line)
                encoded = urllib.parse.quote(full_url)
                rewritten_lines.append(f"{proxy_base_path}/segment?url={encoded}")

            return "\n".join(rewritten_lines) + "\n"
        except Exception as e:
            logger.exception(f"Error rewriting variant playlist {variant_url}: {e}")
            return None

    def fetch_segment(
        self,
        segment_url: str,
        task: IngestTask,
        range_header: Optional[str] = None,
    ) -> Tuple[int, dict, bytes]:
        """Fetches video segment from upstream CDN using engine's session and IP."""
        headers = dict(task.upstream_headers or {})
        if range_header:
            headers["Range"] = range_header

        r = self._session.get(segment_url, headers=headers, timeout=15)
        content_type = r.headers.get("Content-Type", "video/mp2t")
        return r.status_code, {"Content-Type": content_type}, r.content
