FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    DOWNLOAD_DIR=/app/downloads \
    TEMP_DIR=/app/temp \
    LOCAL_CDN_DIR=/app/cdn \
    SQLITE_DB_PATH=/app/data/evo_engine.sqlite3

WORKDIR /app

COPY requirements.txt ./requirements.txt

# Install the browser matching the pinned Python package, plus media tools.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg tini \
    && python -m pip install -r requirements.txt \
    && python -m playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 evo \
    && useradd --uid 10001 --gid evo --create-home evo \
    && mkdir -p /app/data /app/downloads /app/temp /app/cdn \
    && chown -R evo:evo /app

COPY --chown=evo:evo app ./app

USER evo

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import json, urllib.request; h = json.load(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)); assert h['status'] == 'healthy' and h['ffmpeg_available'] and h['ffprobe_available']"

# Reap Chromium/FFmpeg child processes and forward shutdown signals.
ENTRYPOINT ["/usr/bin/tini", "--"]
# The queue, concurrency limits and stream cache live in this process.
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--timeout-graceful-shutdown", "90"]
