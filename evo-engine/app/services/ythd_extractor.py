import json
import logging
import re
import urllib.parse
from typing import List, Optional

from curl_cffi import requests
from app.interfaces.contracts import IStreamExtractor, TitleNotFound
from app.domain.models import StreamSource
from app.core.browser_pool import run_in_browser
from app.core.config import BASE_DIR, settings
from app.core.stealth import StealthBrowser
from app.services.decryptor_cache import DecryptorCache, version_from_page

logger = logging.getLogger("evo.extractor")


class YtHdStreamExtractor(IStreamExtractor):
    """Encapsulated stream extractor for YtHd and StellarConductorNexus.

    Handles single-use token acquisition, API negotiation, WebAssembly
    ChaCha20 decryption, and HLS variant parsing for multi-quality fallback.
    """

    def __init__(self, base_url: str = "https://ythd.org", decryptors: Optional[DecryptorCache] = None):
        self.base_url = base_url.rstrip("/")
        self._decryptors = decryptors or DecryptorCache(BASE_DIR / "data" / "decryptors")

    def extract_streams(
        self,
        tmdb_id: int,
        media_type: str = "movie",
        season: Optional[int] = None,
        episode: Optional[int] = None,
    ) -> List[StreamSource]:
        session = requests.Session(impersonate="chrome124")

        # 1. Fetch vs_src with TV season & episode parameters if applicable
        if media_type == "tv" and season is not None and episode is not None:
            vs_src_url = f"{self.base_url}/vs_src.php?type=tv&id={tmdb_id}&season={season}&episode={episode}"
            embed_url = f"{self.base_url}/embed/{tmdb_id}/{season}/{episode}"
        else:
            vs_src_url = f"{self.base_url}/vs_src.php?type={media_type}&id={tmdb_id}"
            embed_url = f"{self.base_url}/embed/{tmdb_id}"

        r_src = session.get(vs_src_url, headers={"Referer": embed_url})
        if r_src.status_code == 404:
            raise TitleNotFound(f"YtHD has no copy of TMDB {tmdb_id}")
        if r_src.status_code != 200:
            raise RuntimeError(f"Failed to fetch vs_src: {r_src.status_code}")
        src_json = r_src.json()
        if "src" not in src_json:
            raise TitleNotFound(f"YtHD has no copy of TMDB {tmdb_id}")

        movie_url = src_json["src"]

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

        api_base = cfg.get("api")
        if not api_base:
            meta_api = cfg.get("metaApi") or cfg.get("streamBase", "")
            api_base = meta_api + ("&stream_urls" if "&stream_urls" not in meta_api else "")

        stream_api_url = api_base + "&api_token=" + urllib.parse.quote(cfg.get("apiToken", ""))

        # 4. Fetch encrypted stream payload
        r_stream = session.get(
            stream_api_url,
            headers={
                "Referer": f"{player_origin}/",
                "Origin": player_origin,
                "Accept": "application/json",
            },
        )
        if r_stream.status_code == 404:
            raise TitleNotFound(f"YtHD has no streams for TMDB {tmdb_id}")
        if r_stream.status_code != 200:
            raise RuntimeError(f"Stream API returned {r_stream.status_code}")
        stream_json = r_stream.json()
        title = stream_json.get("data", {}).get("title", f"Media_{tmdb_id}")
        imdb_id = stream_json.get("data", {}).get("imdb_id") or cfg.get("imdb")

        # 5. The decryptor script, cached by the version the player page names
        version = version_from_page(r_player.text)

        def vsdec_url(v: str) -> str:
            return f"{player_origin}/embed/iframe_player/assets/vsdec.js?v={v}"

        fetch = lambda url: session.get(url).text
        script, cached = self._decryptors.get(vsdec_url, version, fetch)

        # 6. Decrypt via StealthBrowser WebAssembly runtime
        def decrypt(sb: StealthBrowser, vsdec: str):
            sb.page.goto(player_origin)
            sb.page.evaluate(vsdec)
            return sb.page.evaluate(
                """async (resp) => {
                const origFetch = window.fetch;
                window.fetch = async (url, opts) => {
                    if (url === 'dummy') return { json: async () => resp };
                    return await origFetch(url, opts);
                };
                const res = await window.vsFetchJSON('dummy');
                window.fetch = origFetch;
                // No `data` means the provider answered "nothing here" (or the decryptor is out of date).
                return res && res.data ? res.data.stream_urls : null;
            }""",
                stream_json,
            )

        try:
            decrypted_urls = run_in_browser(lambda sb: decrypt(sb, script))
        except Exception as e:
            if not cached:
                raise
            # The cached copy may be stale (the provider rotated it without changing the version): refresh once.
            logger.warning(f"Decrypting with the cached script failed ({e}); refreshing it")
            script = self._decryptors.refresh(vsdec_url, version, fetch)
            decrypted_urls = run_in_browser(lambda sb: decrypt(sb, script))

        if not decrypted_urls and cached:
            # An out-of-date decryptor looks the same as "nothing here": try a fresh copy once before calling it.
            logger.warning("No streams came out with the cached decryptor; refreshing it once")
            script = self._decryptors.refresh(vsdec_url, version, fetch)
            decrypted_urls = run_in_browser(lambda sb: decrypt(sb, script))

        if not decrypted_urls:
            raise TitleNotFound(f"YtHD returned no streams for TMDB {tmdb_id}")

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
                    parsed_variants = self._parse_variants(r_m3u8.text, st_origin, token, title, player_origin, imdb_id)
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
                    imdb_id=imdb_id,
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
        imdb_id: Optional[str] = None,
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
                        imdb_id=imdb_id,
                    )
                )

        return variants
