import json
import logging
import re
import urllib.parse
from typing import List, Optional

from curl_cffi import requests
from app.interfaces.contracts import IStreamExtractor
from app.domain.models import StreamSource
from app.core.stealth import StealthBrowser
from app.core.filters import RequestFilter

logger = logging.getLogger("evo.extractor")


class YtHdStreamExtractor(IStreamExtractor):
    """Encapsulated stream extractor for YtHd and StellarConductorNexus.

    Handles single-use token acquisition, API negotiation, WebAssembly
    ChaCha20 decryption, and HLS variant parsing for multi-quality fallback.
    """

    def __init__(self, base_url: str = "https://ythd.org"):
        self.base_url = base_url.rstrip("/")

    def extract_streams(self, tmdb_id: int, media_type: str = "movie") -> List[StreamSource]:
        session = requests.Session(impersonate="chrome124")
        embed_url = f"{self.base_url}/embed/{tmdb_id}"

        # 1. Fetch vs_src
        vs_src_url = f"{self.base_url}/vs_src.php?type={media_type}&id={tmdb_id}"
        r_src = session.get(vs_src_url, headers={"Referer": embed_url})
        if r_src.status_code != 200 or "src" not in r_src.json():
            raise RuntimeError(f"Failed to fetch vs_src: {r_src.status_code}")

        movie_url = r_src.json()["src"]

        # 2. Extract player page URL
        r_landing = session.get(movie_url, headers={"Referer": self.base_url})
        m_player = re.search(r'\"playerUrl\":\"([^\"]+)\"', r_landing.text)
        if not m_player:
            raise RuntimeError("Failed to locate playerUrl in landing HTML")
        player_rel = m_player.group(1).replace(r"\u0026", "&")
        player_origin = f"{urllib.parse.urlsplit(movie_url).scheme}://{urllib.parse.urlsplit(movie_url).netloc}"
        player_url = f"{player_origin}{player_rel}"

        # 3. Pull player configuration & single-use API token
        r_player = session.get(player_url, headers={"Referer": f"{player_origin}/"})
        m_cfg = re.search(r'window\.CONFIG\s*=\s*(\{.*?\});', r_player.text)
        if not m_cfg:
            raise RuntimeError("Failed to extract window.CONFIG from player page")
        cfg = json.loads(m_cfg.group(1))

        stream_api_url = cfg["api"] + "&api_token=" + urllib.parse.quote(cfg["apiToken"])

        # 4. Fetch encrypted stream payload
        r_stream = session.get(
            stream_api_url,
            headers={
                "Referer": f"{player_origin}/",
                "Origin": player_origin,
                "Accept": "application/json",
            },
        )
        if r_stream.status_code != 200:
            raise RuntimeError(f"Stream API returned {r_stream.status_code}")
        stream_json = r_stream.json()
        title = stream_json.get("data", {}).get("title", f"Media_{tmdb_id}")

        # 5. Fetch vsdec decryptor WebAssembly script
        r_vsdec = session.get(f"{player_origin}/embed/iframe_player/assets/vsdec.js?v=1786492668")

        # 6. Decrypt via StealthBrowser WebAssembly runtime
        rf = RequestFilter(preset="default", verbose=False)
        with StealthBrowser(headless=True, request_filter=rf) as browser:
            browser.page.goto(player_origin)
            browser.page.evaluate(r_vsdec.text)
            decrypted_urls = browser.page.evaluate(
                """async (resp) => {
                const origFetch = window.fetch;
                window.fetch = async (url, opts) => {
                    if (url === 'dummy') return { json: async () => resp };
                    return await origFetch(url, opts);
                };
                const res = await window.vsFetchJSON('dummy');
                window.fetch = origFetch;
                return res.data.stream_urls;
            }""",
                stream_json,
            )

        if not decrypted_urls:
            raise RuntimeError("No stream URLs decrypted")

        # 7. Generate stream tokens and parse variant qualities
        results: List[StreamSource] = []
        for raw_url in decrypted_urls:
            st_origin = f"{urllib.parse.urlsplit(raw_url).scheme}://{urllib.parse.urlsplit(raw_url).netloc}"
            r_tok = session.get(f"{st_origin}/generate.php", headers={"Referer": f"{player_origin}/"})
            if r_tok.status_code != 200:
                continue

            token = r_tok.text.strip()
            master_url = raw_url + ("&" if "?" in raw_url else "?") + "token=" + urllib.parse.quote(token)

            # Fetch master playlist to parse individual qualities
            try:
                r_m3u8 = session.get(master_url, headers={"Referer": f"{player_origin}/"})
                if r_m3u8.status_code == 200 and "#EXTM3U" in r_m3u8.text:
                    parsed_variants = self._parse_variants(r_m3u8.text, st_origin, token, title, player_origin)
                    if parsed_variants:
                        results.extend(parsed_variants)
                        break  # Found working provider with parsed qualities
            except Exception as e:
                logger.warning(f"Failed to parse variant qualities from {master_url}: {e}")

            # Fallback: add the master playlist as 1080p if parsing fails
            results.append(
                StreamSource(
                    url=master_url,
                    quality="1080p",
                    headers={"Referer": f"{player_origin}/"},
                    title=title,
                )
            )
            break

        return results

    def _parse_variants(
        self,
        m3u8_text: str,
        origin: str,
        token: str,
        title: str,
        player_origin: str,
    ) -> List[StreamSource]:
        lines = [line.strip() for line in m3u8_text.strip().split("\n") if line.strip()]
        variants: List[StreamSource] = []

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

                full_url = uri_line if uri_line.startswith("http") else urllib.parse.urljoin(origin, uri_line)
                if "token=" not in full_url:
                    full_url += ("&" if "?" in full_url else "?") + "token=" + urllib.parse.quote(token)

                variants.append(
                    StreamSource(
                        url=full_url,
                        quality=quality,
                        headers={"Referer": f"{player_origin}/"},
                        title=title,
                    )
                )

        return variants
