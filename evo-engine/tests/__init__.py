"""Engine tests (stdlib unittest): run from tools/evo-engine with
    test/.venv/bin/python -m unittest discover -s tests -t .
Settings are read at import time, so the sandbox env is set before anything from `app` is imported."""
import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="evo-tests-")
os.environ.update(
    SQLITE_DB_PATH=f"{_tmp}/t.sqlite3",
    DOWNLOAD_DIR=f"{_tmp}/dl",
    TEMP_DIR=f"{_tmp}/tmp",
    CDN_PROVIDER="pixeldrain",
    LOCAL_CDN_DIR=f"{_tmp}/cdn",
    LOCAL_CDN_VIDEO_GB="20",
    LOCAL_CDN_SUBTITLE_GB="5",
    EVO_SECRET_TOKEN="s3cret",
    EVO_WEBHOOK_URL="",
    MIN_FREE_DISK_GB="0",
    OPENROUTER_API_KEY="",
    PIXELDRAIN_API_KEY="",
    ERROR_REPORT_URL="",
    TRANSLATE_DAILY_BUDGET_USD="0.5",
)
