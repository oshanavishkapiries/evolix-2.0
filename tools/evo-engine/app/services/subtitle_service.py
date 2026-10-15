import gzip
import io
import json
import logging
import re
from pathlib import Path
from typing import List, Optional, Dict, Any
from curl_cffi import requests

from app.core.config import settings

logger = logging.getLogger("evo.subtitles")

SUPPORTED_LANGUAGES: List[Dict[str, str]] = [
    {"os_code": "eng", "lang": "en", "label": "English"},
    {"os_code": "spa", "lang": "es", "label": "Spanish"},
    {"os_code": "fre", "lang": "fr", "label": "French"},
    {"os_code": "ger", "lang": "de", "label": "German"},
    {"os_code": "por", "lang": "pt", "label": "Portuguese"},
    {"os_code": "ita", "lang": "it", "label": "Italian"},
    {"os_code": "ara", "lang": "ar", "label": "Arabic"},
    {"os_code": "rus", "lang": "ru", "label": "Russian"},
    {"os_code": "sin", "lang": "si", "label": "Sinhala"},
    {"os_code": "hin", "lang": "hi", "label": "Hindi"},
]


def srt_to_vtt(srt_text: str) -> str:
    """Converts SubRip (SRT) format to WebVTT format."""
    # Normalize line endings
    text = srt_text.replace("\r\n", "\n").replace("\r", "\n")
    # Convert timestamp commas to periods
    text = re.sub(
        r"(\d{2}:\d{2}:\d{2}),(\d{3})",
        r"\1.\2",
        text,
    )
    # Strip Byte Order Mark if present
    text = text.lstrip("\ufeff")
    return f"WEBVTT\n\n{text.strip()}\n"


class SubtitleService:
    """Fetches, converts, and caches subtitles from OpenSubtitles."""

    def __init__(self, cache_dir: Optional[Path] = None):
        self.cache_dir = cache_dir or (settings.TEMP_DIR / "subtitles")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._meta_file = self.cache_dir / "index.json"
        self._meta_cache: Dict[str, str] = self._load_meta()

    def _load_meta(self) -> Dict[str, str]:
        if self._meta_file.exists():
            try:
                with open(self._meta_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def _save_meta(self) -> None:
        try:
            with open(self._meta_file, "w", encoding="utf-8") as f:
                json.dump(self._meta_cache, f)
        except Exception as e:
            logger.warning(f"Failed to persist subtitle metadata: {e}")

    def fetch_subtitles(
        self,
        imdb_id: Optional[str],
        season: Optional[int] = None,
        episode: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Queries OpenSubtitles for top available language tracks."""
        if not imdb_id:
            return []

        clean_imdb = re.sub(r"\D", "", imdb_id)
        if not clean_imdb:
            return []
        padded_imdb = f"{int(clean_imdb):07d}"

        results: List[Dict[str, Any]] = []
        session = requests.Session()

        for lang_info in SUPPORTED_LANGUAGES:
            os_code = lang_info["os_code"]
            lang_code = lang_info["lang"]
            label = lang_info["label"]

            if season is not None and episode is not None:
                url = (
                    f"https://rest.opensubtitles.org/search/episode-{episode}"
                    f"/imdbid-{padded_imdb}/season-{season}/sublanguageid-{os_code}"
                )
            else:
                url = f"https://rest.opensubtitles.org/search/imdbid-{padded_imdb}/sublanguageid-{os_code}"

            try:
                r = session.get(
                    url,
                    headers={
                        "User-Agent": "Mozilla/5.0",
                        "X-User-Agent": "trailers.to-UA",
                    },
                    timeout=5,
                )
                if r.status_code != 200:
                    continue

                items = r.json()
                if not items or not isinstance(items, list):
                    continue

                best = items[0]
                dl_link = best.get("SubDownloadLink")
                file_id = best.get("IDSubtitleFile") or re.search(r"/filead/(\d+)", dl_link or "")
                file_id_str = file_id.group(1) if hasattr(file_id, "group") else str(file_id or "0")

                sub_id = f"sub_{clean_imdb}_{lang_code}_{file_id_str}"
                self._meta_cache[sub_id] = dl_link
                self._save_meta()

                results.append(
                    {
                        "id": sub_id,
                        "label": label,
                        "language": lang_code,
                        "format": "vtt",
                        "url": f"/api/v1/media/subtitles/{sub_id}.vtt",
                    }
                )
            except Exception as e:
                logger.debug(f"Subtitle search error for {lang_code}: {e}")

        return results

    def get_vtt(self, sub_id: str) -> Optional[str]:
        """Loads and returns WebVTT content for a given subtitle ID, downloading & converting if needed."""
        vtt_file = self.cache_dir / f"{sub_id}.vtt"
        if vtt_file.exists():
            return vtt_file.read_text(encoding="utf-8", errors="replace")

        dl_link = self._meta_cache.get(sub_id)
        if not dl_link:
            return None

        try:
            session = requests.Session()
            r = session.get(dl_link, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            if r.status_code != 200:
                return None

            raw_bytes = r.content
            # Check if gzip-compressed
            if raw_bytes[:2] == b"\x1f\x8b":
                srt_content = gzip.decompress(raw_bytes).decode("utf-8", errors="replace")
            else:
                srt_content = raw_bytes.decode("utf-8", errors="replace")

            vtt_content = srt_to_vtt(srt_content)
            vtt_file.write_text(vtt_content, encoding="utf-8")
            return vtt_content
        except Exception as e:
            logger.error(f"Failed to download/convert subtitle {sub_id}: {e}")
            return None
