from pathlib import Path
from pydantic_settings import BaseSettings
from typing import Literal


APP_NAME = "Evo-Engine Media Service"
BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    # Directories
    DOWNLOAD_DIR: Path = BASE_DIR / "downloads"
    TEMP_DIR: Path = BASE_DIR / "temp"
    SQLITE_DB_PATH: Path = BASE_DIR / "data" / "evo_engine.sqlite3"

    # External Storage / CDN
    PIXELDRAIN_API_KEY: str = ""
    CDN_PROVIDER: Literal["pixeldrain", "local"] = "pixeldrain"
    LOCAL_CDN_DIR: Path = BASE_DIR / "cdn"
    LOCAL_CDN_VIDEO_GB: float = 20
    LOCAL_CDN_SUBTITLE_GB: float = 5

    # Security: Shared token for Next.js / Vercel proxy
    EVO_SECRET_TOKEN: str = ""

    # Where finished cache jobs are reported (Next.js POST /api/evo/complete). Empty = no webhook.
    EVO_WEBHOOK_URL: str = ""
    # Where errors are reported (the app's POST /api/errors). Empty = derived from EVO_WEBHOOK_URL's host.
    ERROR_REPORT_URL: str = ""
    # Name shown on reported errors; empty = the host name.
    ENGINE_NAME: str = ""

    # Resource limits: extraction launches a headless browser, downloads/uploads move whole films.
    MAX_CONCURRENT_EXTRACTIONS: int = 2
    MAX_CONCURRENT_DOWNLOADS: int = 2
    # Jobs waiting for extraction beyond this are refused (HTTP 503) instead of piling up.
    MAX_QUEUED_TASKS: int = 50
    # Background caching is skipped (streaming still works) below this much free disk.
    MIN_FREE_DISK_GB: float = 10.0
    # Browser pool (extraction). 0 = launch a fresh browser per extraction (the old behaviour).
    BROWSER_POOL_SIZE: int = 2
    # A pooled browser is replaced after this many extractions, or when its process tree grows past the RSS limit (0 = no limit).
    BROWSER_MAX_USES: int = 25
    BROWSER_RECYCLE_RSS_MB: int = 1500
    # Skip images, fonts, media and ad/tracker hosts on provider pages (1 = on).
    BLOCK_ASSETS: int = 1

    # Stream URLs from a recent extraction are reused for other qualities of the same title. 0 = always extract fresh.
    EXTRACTION_REUSE_TTL_S: int = 300

    # A provider that fails this many times in a row within the window sits out for the cool-down (0 = never skip providers).
    PROVIDER_FAIL_THRESHOLD: int = 3
    PROVIDER_FAIL_WINDOW_S: int = 600
    PROVIDER_COOLDOWN_S: int = 300
    # "Title not found" answers do not count as failures, unless a provider gives this many in a row without ever
    # finding a title (then it is probably broken, not the titles). 0 = never cool down for them.
    PROVIDER_MISS_THRESHOLD: int = 10

    # Which stream provider is tried first: "cinesrc,ythd" or "ythd,cinesrc". The others are the fallback.
    EXTRACTOR_ORDER: str = "cinesrc,ythd"

    # Keep the YtHD decryptor script on disk by version (1 = on).
    YTHD_DECRYPTOR_CACHE: int = 1

    # Delete leftover files in DOWNLOAD_DIR at startup (they belong to tasks that died with the process).
    CLEAN_ORPHANS_ON_START: bool = False

    # Sinhala subtitle translation (English SRT -> casual spoken Sinhala) through OpenRouter.
    # Disabled while OPENROUTER_API_KEY is empty.
    OPENROUTER_API_KEY: str = ""
    TRANSLATE_MODEL: str = "google/gemini-3.1-flash-lite"
    TRANSLATE_CHUNK_CUES: int = 50
    TRANSLATE_CONTEXT_CUES: int = 4
    TRANSLATE_CONCURRENCY: int = 4
    # Hard stop for the day (UTC); translation resumes tomorrow or when raised. 0 or less = unlimited (spend is still ledgered).
    TRANSLATE_DAILY_BUDGET_USD: float = 0.0

    class Config:
        env_file = BASE_DIR / ".env"
        extra = "ignore"


settings = Settings()
settings.DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
