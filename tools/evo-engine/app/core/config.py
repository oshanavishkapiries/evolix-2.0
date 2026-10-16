from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "Evo-Engine Media Service"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False

    # Directories
    BASE_DIR: Path = Path(__file__).resolve().parent.parent.parent
    DOWNLOAD_DIR: Path = BASE_DIR / "downloads"
    TEMP_DIR: Path = BASE_DIR / "temp"
    SQLITE_DB_PATH: Path = BASE_DIR / "data" / "evo_engine.sqlite3"

    # External Storage / CDN
    PIXELDRAIN_API_KEY: str = ""

    # Security: Shared token for Next.js / Vercel proxy
    EVO_SECRET_TOKEN: str = ""

    # Where finished cache jobs are reported (Next.js POST /api/evo/complete). Empty = no webhook.
    EVO_WEBHOOK_URL: str = ""

    # Resource limits: extraction launches a headless browser, downloads/uploads move whole films.
    MAX_CONCURRENT_EXTRACTIONS: int = 2
    MAX_CONCURRENT_DOWNLOADS: int = 2
    # Jobs waiting for extraction beyond this are refused (HTTP 503) instead of piling up.
    MAX_QUEUED_TASKS: int = 50
    # Background caching is skipped (streaming still works) below this much free disk.
    MIN_FREE_DISK_GB: float = 10.0
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

    # Browsers never call the engine directly (Next.js proxies it); list origins here only if that changes.
    CORS_ORIGINS: str = ""

    # Database integration (optional direct update)
    DATABASE_URL: str = ""

    class Config:
        env_file = [
            Path(__file__).resolve().parent.parent.parent / ".env",
            Path(__file__).resolve().parent.parent.parent.parent / ".env",
            Path(__file__).resolve().parent.parent.parent.parent.parent / ".env",
        ]
        extra = "ignore"


settings = Settings()
settings.DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.TEMP_DIR.mkdir(parents=True, exist_ok=True)
