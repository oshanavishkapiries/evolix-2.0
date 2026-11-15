import gzip
import hashlib
import html
import json
from concurrent.futures import ThreadPoolExecutor
import logging
import re
import time
import threading
import os
import tempfile
from pathlib import Path
from typing import List, Optional, Dict, Any
from curl_cffi import requests

from app.core.config import settings

logger = logging.getLogger("evo.subtitles")
MAX_SUBTITLE_BYTES = 2 * 1024 * 1024


def validate_subtitle(raw: bytes, episode: bool = False, runtime_minutes: Optional[int] = None, strict: bool = True) -> str:
    """Decode, sanitize and parse a subtitle before it reaches storage or translation.

    strict (uploads): any malformed cue rejects the file. Not strict (provider downloads): real files often carry a few
    overlapping, zero-length or empty cues, so those are skipped and the file is kept while at least 90% of cues are good.
    """
    if not raw or len(raw) > MAX_SUBTITLE_BYTES:
        raise ValueError("Subtitle must be non-empty and at most 2 MB")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        from charset_normalizer import from_bytes
        decoded = from_bytes(raw).best()
        if decoded is None or decoded.chaos > 0.2:
            raise ValueError("Could not decode the subtitle text")
        text = str(decoded)
    if "\x00" in text or text.count("\ufffd") / max(1, len(text)) > 0.02:
        raise ValueError("Subtitle contains invalid text encoding")
    text = re.sub(r"<(script|style)\b[^>]*>.*?</\1\s*>", "", text, flags=re.I | re.S)
    # Only tag-shaped text: a stray "<3" must not swallow everything up to the next ">" (the one in "-->").
    tag = re.compile(r"</?[a-zA-Z][^>\n]*>")
    text = html.unescape(tag.sub("", text))
    # An encoded tag must not become executable markup after unescaping.
    text = tag.sub("", text)
    # Leftover "<" is plain text; WebVTT would read it as the start of a tag.
    text = text.replace("<", "&lt;")
    text = text.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    timing = re.compile(r"^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)[,.](\d{3})\s+-->\s+(?:(\d{2,}):)?([0-5]\d):([0-5]\d)[,.](\d{3})(?:\s+.*)?$")
    previous = -1.0
    end = 0.0
    cues = 0
    skipped = 0
    valid = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.splitlines()
        for i, line in enumerate(lines):
            if "-->" not in line:
                continue
            match = timing.fullmatch(line.strip())
            if not match or not any(l.strip() for l in lines[i + 1:]):
                if strict:
                    raise ValueError("Subtitle has an invalid or empty cue")
                skipped += 1
                break
            h, m, s, ms, eh, em, es, ems = match.groups()
            start = int(h or 0) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000
            stop = int(eh or 0) * 3600 + int(em) * 60 + int(es) + int(ems) / 1000
            if stop <= start or (strict and start < previous):
                if strict:
                    raise ValueError("Subtitle cue times must be ordered with a positive duration")
                skipped += 1
                break
            previous, end = max(previous, start), max(end, stop)
            cues += 1
            valid.append("\n".join(lines[i:]))
            break
    if skipped and skipped > (cues + skipped) * 0.1:
        raise ValueError(f"Subtitle has too many invalid cues ({skipped} of {cues + skipped})")
    minimum = 20 if episode else 50
    if cues < minimum:
        raise ValueError(f"Subtitle has {cues} cues; expected at least {minimum}")
    if runtime_minutes and abs(end - runtime_minutes * 60) > runtime_minutes * 60 * 0.15:
        raise ValueError("Subtitle duration differs from this title's runtime by more than 15%")
    return srt_to_vtt("\n\n".join(valid))

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
        r"((?:\d{2,}:)?\d{2}:\d{2}),(\d{3})",
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
        self._meta_lock = threading.Lock()
        self._meta_cache: Dict[str, Any] = self._load_meta()
        self._last_errors: Dict[str, str] = {}

    def _load_meta(self) -> Dict[str, Any]:
        if self._meta_file.exists():
            try:
                with open(self._meta_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return data if isinstance(data, dict) else {}
            except Exception:
                pass
        return {}

    def _save_meta(self) -> None:
        try:
            with self._meta_lock:
                snapshot = {k: v.copy() if isinstance(v, dict) else v for k, v in self._meta_cache.copy().items()}
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.cache_dir, delete=False) as f:
                    json.dump(snapshot, f)
                    temp = f.name
                os.replace(temp, self._meta_file)
        except Exception as e:
            logger.warning(f"Failed to persist subtitle metadata: {e}")

    def fetch_subtitles(
        self,
        imdb_id: Optional[str],
        season: Optional[int] = None,
        episode: Optional[int] = None,
        language: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Queries OpenSubtitles for top available language tracks."""
        if not imdb_id:
            return []

        clean_imdb = re.sub(r"\D", "", imdb_id)
        if not clean_imdb:
            return []
        padded_imdb = f"{int(clean_imdb):07d}"

        def search(lang_info: Dict[str, str]) -> Optional[Dict[str, Any]]:
            os_code = lang_info["os_code"]
            lang_code = lang_info["lang"]

            if season is not None and episode is not None:
                url = (
                    f"https://rest.opensubtitles.org/search/episode-{episode}"
                    f"/imdbid-{padded_imdb}/season-{season}/sublanguageid-{os_code}"
                )
            else:
                url = f"https://rest.opensubtitles.org/search/imdbid-{padded_imdb}/sublanguageid-{os_code}"

            try:
                r = requests.get(
                    url,
                    headers={
                        "User-Agent": "Mozilla/5.0",
                        "X-User-Agent": "trailers.to-UA",
                    },
                    timeout=5,
                )
                if r.status_code != 200:
                    return None

                items = r.json()
                if not items or not isinstance(items, list):
                    return None

                candidates = []
                for rank, candidate in enumerate(items[:5], start=1):
                    dl_link = candidate.get("SubDownloadLink")
                    if not dl_link:
                        continue
                    file_id = candidate.get("IDSubtitleFile") or re.search(r"/filead/(\d+)", dl_link)
                    file_id_str = file_id.group(1) if hasattr(file_id, "group") else str(file_id or rank)
                    candidates.append({
                        "sub_id": f"sub_{clean_imdb}_{lang_code}_{file_id_str}",
                        "dl_link": dl_link,
                        "rank": rank,
                        "downloads": candidate.get("SubDownloadsCnt"),
                        "release": candidate.get("MovieReleaseName"),
                        "rating": candidate.get("SubRating"),
                        "file_name": candidate.get("SubFileName"),
                    })
                if not candidates:
                    return None
                best = candidates[0]
                sub_id = best["sub_id"]
                return {
                    "id": sub_id,
                    "label": lang_info["label"],
                    "language": lang_code,
                    "format": "vtt",
                    "url": f"/api/v1/media/subtitles/{sub_id}.vtt",
                    "source": "auto",
                    "originRef": sub_id.rsplit("_", 1)[-1],
                    "_candidates": candidates,
                    "_episode": episode is not None,
                }
            except Exception as e:
                logger.debug(f"Subtitle search error for {lang_code}: {e}")
                return None

        # One request per language, all at once: the whole lookup costs one timeout instead of ten.
        languages = [l for l in SUPPORTED_LANGUAGES if language is None or l["lang"] == language]
        with ThreadPoolExecutor(max_workers=max(1, len(languages))) as pool:
            found = [r for r in pool.map(search, languages) if r]

        results: List[Dict[str, Any]] = []
        for item in found:
            candidates = item.pop("_candidates")
            episode = item.pop("_episode")
            for candidate in candidates:
                old = self._meta_cache.get(candidate["sub_id"], {})
                self._meta_cache[candidate["sub_id"]] = {**(old if isinstance(old, dict) else {}), "candidates": [candidate], "episode": episode}
            self._meta_cache[item["id"]].update({"candidates": candidates, "episode": episode})
            results.append(item)
        if results:
            self._save_meta()
        return results

    def search_candidates(self, imdb_id: str, language: str = "en", season: Optional[int] = None, episode: Optional[int] = None) -> List[dict]:
        tracks = self.fetch_subtitles(imdb_id, season, episode, language)
        return [
            {"ref": c["sub_id"], "release": c.get("release") or "OpenSubtitles", "downloads": int(c.get("downloads") or 0),
             "rating": float(c["rating"]) if c.get("rating") else None, "lang": t["language"], "fileName": c.get("file_name") or c.get("release") or c["sub_id"]}
            for t in tracks for c in self._meta_cache[t["id"]]["candidates"]
        ]

    def store_upload(self, raw: bytes, episode: bool = False, runtime_minutes: Optional[int] = None) -> str:
        vtt = validate_subtitle(raw, episode, runtime_minutes)
        sub_id = "upload_" + hashlib.sha256(raw).hexdigest()
        self.save_vtt(sub_id, vtt)
        return sub_id

    def has_vtt(self, sub_id: str) -> bool:
        return (self.cache_dir / f"{sub_id}.vtt").exists()

    def delete_vtt(self, sub_id: str) -> None:
        (self.cache_dir / f"{sub_id}.vtt").unlink(missing_ok=True)

    def purge_translations(self) -> int:
        """Forgets every cached Sinhala translation (`si_*.vtt`), so the next request translates again from the English
        file. Fetched and uploaded tracks are left alone. Returns how many files were removed."""
        n = 0
        for f in self.cache_dir.glob("si_*.vtt"):
            f.unlink(missing_ok=True)
            n += 1
        return n

    def save_vtt(self, sub_id: str, vtt: str) -> None:
        """Stores a generated track (e.g. a translation) so get_vtt() serves it like a fetched one."""
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.cache_dir, delete=False) as f:
            f.write(vtt)
            temp = f.name
        os.replace(temp, self.cache_dir / f"{sub_id}.vtt")

    def get_vtt(self, sub_id: str) -> Optional[str]:
        """Loads and returns WebVTT content for a given subtitle ID, downloading & converting if needed."""
        vtt_file = self.cache_dir / f"{sub_id}.vtt"
        if vtt_file.exists():
            return vtt_file.read_text(encoding="utf-8", errors="replace")

        entry = self._meta_cache.get(sub_id)
        if not entry:
            self._last_errors[sub_id] = "No download link is cached for this subtitle"
            return None
        # Old index.json entries were plain URL strings; keep serving those.
        candidates = entry.get("candidates", []) if isinstance(entry, dict) else [{"dl_link": entry}]
        if not candidates and isinstance(entry, dict) and entry.get("dl_link"):
            candidates = [entry]
        minimum_cues = 20 if isinstance(entry, dict) and entry.get("episode") else 50
        failures = []
        for candidate in candidates:
            for attempt, delay in enumerate((0, 0.5, 1.5), start=1):
                if delay:
                    time.sleep(delay)
                try:
                    source_url = candidate["dl_link"]
                    if source_url.startswith("evo-local://"):
                        from app.services.storage import local_storage
                        from app.services.local_storage import validate_file_id
                        file_id = validate_file_id(source_url[len("evo-local://"):])
                        if not file_id.endswith(".vtt"):
                            raise ValueError("Local subtitle source must be a VTT file")
                        provider = local_storage()
                        handle = provider.open_file(file_id)
                        try:
                            # validate_subtitle has a 2 MB limit; bound local reads too.
                            raw_bytes = handle.read(2 * 1024 * 1024 + 1)
                        finally:
                            provider.close_file(file_id, handle)
                    else:
                        session = requests.Session()
                        try:
                            r = session.get(source_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
                        finally:
                            session.close()
                        if r.status_code != 200:
                            reason = f"HTTP {r.status_code}"
                            logger.warning("Subtitle download %s candidate %s attempt %s failed: %s", sub_id, candidate.get("rank", 1), attempt, reason)
                            failures.append(reason)
                            continue
                        raw_bytes = r.content
                    if raw_bytes[:2] == b"\x1f\x8b":
                        raw_bytes = gzip.decompress(raw_bytes)
                    decoded = raw_bytes.decode("utf-8", errors="replace")
                    replacement_ratio = decoded.count("\ufffd") / max(1, len(decoded))
                    if replacement_ratio > 0.02:
                        reason = f"invalid text encoding ({replacement_ratio:.0%} replacement characters)"
                    else:
                        try:
                            vtt = validate_subtitle(raw_bytes, episode=minimum_cues == 20, strict=False)
                        except ValueError as e:
                            reason = str(e)
                        else:
                            self.save_vtt(sub_id, vtt)
                            if isinstance(entry, dict):
                                entry["resolved_ref"] = candidate.get("sub_id", sub_id)
                                entry["resolved_release"] = candidate.get("release")
                                self._save_meta()
                            self._last_errors.pop(sub_id, None)
                            return vtt
                    logger.warning("Subtitle download %s candidate %s rejected: %s", sub_id, candidate.get("rank", 1), reason)
                    failures.append(reason)
                    break
                except Exception as e:
                    reason = str(e) or type(e).__name__
                    logger.warning("Subtitle download %s candidate %s attempt %s failed: %s", sub_id, candidate.get("rank", 1), attempt, reason)
                    failures.append(reason)
        reasons = "; ".join(dict.fromkeys(failures))
        self._last_errors[sub_id] = f"All {len(candidates)} subtitle candidates failed: {reasons}" if failures else "No usable subtitle candidates"
        return None

    def get_last_error(self, sub_id: str) -> Optional[str]:
        return self._last_errors.get(sub_id)

    def resolved_ref(self, sub_id: str) -> str:
        entry = self._meta_cache.get(sub_id)
        return entry.get("resolved_ref", sub_id) if isinstance(entry, dict) else sub_id

    def origin_ref(self, sub_id: str) -> str:
        resolved = self.resolved_ref(sub_id)
        return resolved.rsplit("_", 1)[-1] if resolved.startswith("sub_") else resolved

    def forget_publication(self, url: str) -> None:
        for entry in self._meta_cache.copy().values():
            if isinstance(entry, dict) and entry.get("cdn_url") == url:
                entry.pop("cdn_url", None)
        self._save_meta()
