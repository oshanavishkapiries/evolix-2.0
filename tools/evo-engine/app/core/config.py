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
