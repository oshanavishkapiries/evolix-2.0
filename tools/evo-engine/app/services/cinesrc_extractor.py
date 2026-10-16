import logging
import re
import urllib.parse
from typing import Dict, List, Optional, Tuple

from app.interfaces.contracts import IStreamExtractor
from app.domain.models import StreamSource
from app.core.stealth import StealthBrowser

logger = logging.getLogger("evo.cinesrc_extractor")

POLL_MS = 250


def height_to_quality(width: int, height: int) -> str:
    if height >= 1000 or width >= 1900:
        return "1080p"
    if height >= 700 or width >= 1200:
        return "720p"
    if height >= 450 or width >= 600:
        return "480p"
    if height >= 300:
        return "360p"
    return f"{height}p"


class CineSrcStreamExtractor(IStreamExtractor):
    """Stream extractor for CineSrc (cinesrc.st).

    Runs in a stealth headless browser so the site's own player solves its anti-bot challenges, and captures the
    master HLS playlist the player requests. The extractor is shared by concurrent tasks, so it keeps no per-call
    state on the instance. Titles and IMDb ids are the app's job (the page only knows the site's name).
    """

    def __init__(self, base_url: str = "https://cinesrc.st", timeout_seconds: int = 40):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def extract_streams(
        self,
        tmdb_id: int,
        media_type: str = "movie",
        season: Optional[int] = None,
        episode: Optional[int] = None,
    ) -> List[StreamSource]:
        """Extracts the playable HLS variants (one per quality) from CineSrc."""
        if media_type == "tv" and season is not None and episode is not None:
            embed_url = f"{self.base_url}/embed/tv/{tmdb_id}?s={season}&e={episode}&controls=false&autoplay=true&da=true"
        else:
            embed_url = f"{self.base_url}/embed/movie/{tmdb_id}?controls=false&autoplay=true&da=true"
        logger.info(f"Navigating to CineSrc embed: {embed_url}")

        master: List[Tuple[str, str]] = []  # at most one (url, body); a list so the handler can fill it

        with StealthBrowser(headless=True) as sb:
            page = sb.page

            def handle_response(resp):
                if master or "/api/playlist/" not in resp.url or resp.status != 200:
                    return
                try:
                    text = resp.text()
                except Exception as e:
                    logger.debug(f"Error reading playlist body: {e}")
                    return
                if "#EXTM3U" in text:
                    master.append((resp.url, text))
                    logger.info(f"Captured master playlist: {resp.url[:100]}...")

            page.on("response", handle_response)
            try:
                # The player streams forever, so "networkidle" never settles: return as soon as the page is up and poll for the playlist.
                page.goto(embed_url, wait_until="domcontentloaded", timeout=self.timeout_seconds * 1000)
            except Exception as nav_err:
                logger.warning(f"Navigation did not finish cleanly: {nav_err}")
            for _ in range(int(self.timeout_seconds * 1000 / POLL_MS)):
                if master:
                    break
                page.wait_for_timeout(POLL_MS)

        if not master:
            raise RuntimeError(f"CineSrc failed to resolve stream for {media_type} TMDB {tmdb_id}")

        master_url, body = master[0]
        variants = self._parse_variants(body, master_url)
        logger.info(f"Extracted {len(variants)} quality variant(s) from CineSrc")
        return variants

    def _parse_variants(self, m3u8_text: str, master_url: str) -> List[StreamSource]:
        """One StreamSource per quality (the highest-bandwidth rendition wins), best quality first."""
        headers = {"Referer": f"{self.base_url}/", "Origin": self.base_url}
        lines = [line.strip() for line in m3u8_text.strip().split("\n") if line.strip()]
        best: Dict[str, Tuple[int, str]] = {}

        for i, line in enumerate(lines):
            if not line.startswith("#EXT-X-STREAM-INF:"):
                continue
            uri = lines[i + 1] if i + 1 < len(lines) else None
            if not uri or uri.startswith("#"):
                continue
            res = re.search(r"RESOLUTION=(\d+)x(\d+)", line)
            bw = re.search(r"BANDWIDTH=(\d+)", line)
            quality = height_to_quality(int(res.group(1)), int(res.group(2))) if res else "720p"
            bandwidth = int(bw.group(1)) if bw else 0
            # Relative URIs are relative to the playlist that lists them, not to the site root.
            url = urllib.parse.urljoin(master_url, uri)
            if quality not in best or bandwidth > best[quality][0]:
                best[quality] = (bandwidth, url)

        if not best:
            # The captured playlist is itself a media playlist (single rendition): its quality is unknown, assume the default.
            return [StreamSource(url=master_url, quality="720p", headers=headers)]

        order = {"1080p": 0, "720p": 1, "480p": 2, "360p": 3}
        return [StreamSource(url=u, quality=q, headers=headers) for q, (_, u) in sorted(best.items(), key=lambda kv: order.get(kv[0], 9))]
