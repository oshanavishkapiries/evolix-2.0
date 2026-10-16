import logging
import re
import urllib.parse
from typing import List, Optional, Tuple

from app.interfaces.contracts import IStreamExtractor
from app.domain.models import StreamSource
from app.core.stealth import StealthBrowser

logger = logging.getLogger("evo.cinesrc_extractor")


class CineSrcStreamExtractor(IStreamExtractor):
    """Production stream extractor for CineSrc (cinesrc.st).

    Executes in a stealth headless browser to satisfy CineSrc's multi-stage
    anti-bot challenges (WebAssembly + WebWorker + bytecode VM).
    Captures live master HLS playlists and multi-language subtitles.
    """

    def __init__(self, base_url: str = "https://cinesrc.st", timeout_seconds: int = 30):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.last_subtitles: List[dict] = []

    def extract_streams(
        self,
        tmdb_id: int,
        media_type: str = "movie",
        season: Optional[int] = None,
        episode: Optional[int] = None,
    ) -> List[StreamSource]:
        """Extracts playable master and variant HLS stream URLs from CineSrc."""
        # 1. Build embed target URL
        if media_type == "tv" and season is not None and episode is not None:
            embed_url = f"{self.base_url}/embed/tv/{tmdb_id}?s={season}&e={episode}&controls=false&autoplay=true&da=true"
        else:
            embed_url = f"{self.base_url}/embed/movie/{tmdb_id}?controls=false&autoplay=true&da=true"

        logger.info(f"Navigating to CineSrc embed: {embed_url}")

        master_playlist: Optional[Tuple[str, str]] = None
        captured_subtitles: List[dict] = []

        # 2. Launch stealth browser and intercept stream network responses
        with StealthBrowser(headless=True) as sb:
            page = sb.page

            def handle_response(resp):
                nonlocal master_playlist, captured_subtitles
                url = resp.url

                # Intercept master playlist response
                if "/api/playlist/" in url and resp.status == 200 and not master_playlist:
                    try:
                        text = resp.text()
                        if "#EXT-X-STREAM-INF" in text or "#EXTM3U" in text:
                            master_playlist = (url, text)
                            logger.info(f"Captured master playlist: {url[:100]}...")
                    except Exception as e:
                        logger.debug(f"Error reading playlist body: {e}")

                # Intercept subtitle search results
                if "/api/subtitles/search" in url and resp.status == 200:
                    try:
                        data = resp.json()
                        raw_subs = data.get("subtitles", [])
                        if raw_subs:
                            captured_subtitles = raw_subs
                            logger.info(f"Captured {len(raw_subs)} subtitle tracks from CineSrc")
                    except Exception as e:
                        logger.debug(f"Error reading subtitles body: {e}")

            page.on("response", handle_response)

            try:
                page.goto(embed_url, wait_until="networkidle", timeout=self.timeout_seconds * 1000)
            except Exception as nav_err:
                logger.warning(f"Navigation wait finished/timed out: {nav_err}")

            # If master playlist was not caught immediately, wait up to an extra 10s for challenge solve
            if not master_playlist:
                for _ in range(20):
                    if master_playlist:
                        break
                    page.wait_for_timeout(500)

            # Store any discovered subtitles
            self.last_subtitles = captured_subtitles

            # Pull media title if rendered
            title = None
            try:
                page_title = page.title()
                if " - " in page_title:
                    title = page_title.split(" - ")[0].strip()
            except Exception:
                pass

        if not master_playlist:
            raise RuntimeError(f"CineSrc failed to resolve stream for {media_type} TMDB {tmdb_id}")

        master_url, m3u8_text = master_playlist

        # 3. Parse variants into StreamSource list
        variants = self._parse_variants(
            m3u8_text=m3u8_text,
            master_url=master_url,
            title=title or f"Media_{tmdb_id}",
        )

        if not variants:
            # Fallback to master URL if variant parsing was empty
            variants = [
                StreamSource(
                    url=master_url,
                    quality="1080p",
                    headers={"Referer": f"{self.base_url}/", "Origin": self.base_url},
                    title=title,
                )
            ]

        logger.info(f"Successfully extracted {len(variants)} stream quality variants from CineSrc")
        return variants

    def _parse_variants(
        self,
        m3u8_text: str,
        master_url: str,
        title: str,
    ) -> List[StreamSource]:
        """Parses multi-quality HLS streams from the master manifest."""
        lines = [line.strip() for line in m3u8_text.strip().split("\n") if line.strip()]
        variants: List[StreamSource] = []

        headers = {"Referer": f"{self.base_url}/", "Origin": self.base_url}

        for i in range(len(lines)):
            if lines[i].startswith("#EXT-X-STREAM-INF:"):
                inf_line = lines[i]
                uri_line = lines[i + 1] if i + 1 < len(lines) else None
                if not uri_line or uri_line.startswith("#"):
                    continue

                res_match = re.search(r"RESOLUTION=(\d+)x(\d+)", inf_line)
                width = int(res_match.group(1)) if res_match else 0
                height = int(res_match.group(2)) if res_match else 0

                if height >= 1000 or width >= 1900:
                    quality = "1080p"
                elif height >= 700 or width >= 1200:
                    quality = "720p"
                elif height >= 450 or width >= 600:
                    quality = "480p"
                elif height >= 300:
                    quality = "360p"
                else:
                    quality = f"{height}p"

                full_url = uri_line if uri_line.startswith("http") else urllib.parse.urljoin(self.base_url, uri_line)

                variants.append(
                    StreamSource(
                        url=full_url,
                        quality=quality,
                        headers=headers,
                        title=title,
                    )
                )

        # Include the master playlist as well so clients can perform adaptive bitrate streaming
        variants.append(
            StreamSource(
                url=master_url,
                quality="master",
                headers=headers,
                title=title,
            )
        )

        return variants
