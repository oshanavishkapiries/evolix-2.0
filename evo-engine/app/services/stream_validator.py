import logging
import urllib.parse
from typing import List, Optional

from curl_cffi import requests

from app.domain.models import StreamSource

logger = logging.getLogger("evo.stream_validator")

PREFERRED = ["720p", "1080p", "480p", "360p"]


def _first_uri(playlist: str) -> Optional[str]:
    for line in playlist.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            return line
    return None


def validate_streams(streams: List[StreamSource], timeout: int = 12) -> None:
    """Proves a provider's streams are really playable before the pipeline commits to them.

    Fetches the playlist and the first media chunk the way the HLS proxy will (same TLS fingerprint, provider headers).
    Raises RuntimeError when anything is refused, so the composite extractor can fall back to the next provider.
    """
    if not streams:
        raise RuntimeError("no streams to validate")
    by_q = {s.quality: s for s in streams}
    stream = next((by_q[q] for q in PREFERRED if q in by_q), streams[0])
    session = requests.Session(impersonate="chrome124")

    url = stream.url
    for _ in range(3):  # master -> media playlist -> chunk
        r = session.get(url, headers=stream.headers, timeout=timeout)
        if r.status_code != 200 or "#EXTM3U" not in r.text:
            raise RuntimeError(f"playlist refused (HTTP {r.status_code}) for {stream.quality}")
        child = _first_uri(r.text)
        if not child:
            raise RuntimeError("playlist lists nothing to play")
        child_url = urllib.parse.urljoin(url, child)
        if "#EXT-X-STREAM-INF" in r.text:
            url = child_url  # still a master playlist: descend
            continue
        # Media playlist: its first entry is a chunk. A couple of KB prove the CDN lets us in.
        c = session.get(child_url, headers={**stream.headers, "Range": "bytes=0-2047"}, timeout=timeout)
        if c.status_code not in (200, 206) or not c.content:
            raise RuntimeError(f"first chunk refused (HTTP {c.status_code}) for {stream.quality}")
        return
    raise RuntimeError("playlist nesting too deep")
