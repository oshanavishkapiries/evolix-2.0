#!/usr/bin/env python3
"""Pipeline for processing Sinhala Dubbed Kids Movies from @Oshan2k02:
1. Download video file from Telegram.
2. Check video stream:
   - If H.264 (x264) in .mp4: remux / copy directly (instant!).
   - If HEVC (x265) / .mkv: transcode video to H.264 MP4 (libx264 veryfast crf 22).
3. Upload to Pixeldrain.
4. Add to sources table in DB with audio_language = 'si' and audience = 'kids'.
5. Clean up local files immediately.
"""

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv
from telethon import TelegramClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("pipeline_kids_movies.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("kids_pipeline")

TOOLS_DIR = Path(__file__).resolve().parent
PROJECT_DIR = TOOLS_DIR.parent
load_dotenv(TOOLS_DIR / ".env")
load_dotenv(PROJECT_DIR / ".env")

API_ID = int(os.getenv("API_ID"))
API_HASH = os.getenv("API_HASH")
SESSION_NAME = str(TOOLS_DIR / os.getenv("SESSION_NAME", "session"))
PIXELDRAIN_API_KEY = os.getenv("PIXELDRAIN_API_KEY")

DOWNLOAD_DIR = TOOLS_DIR / "downloads"
CONVERT_DIR = TOOLS_DIR / "converted"

for d in (DOWNLOAD_DIR, CONVERT_DIR):
    d.mkdir(parents=True, exist_ok=True)

# 4 Movies from @Oshan2k02 needing processing:
QUEUE = [
    {
        "msg_id": 37729,
        "title": "Bridge to Terabithia",
        "movie_id": "18cf4d20-0772-4732-9ecf-aa9b14b22c9a",
        "quality": "720p",
    },
    {
        "msg_id": 37735,
        "title": "Despicable Me",
        "movie_id": "670468eb-e17b-407e-afc2-b0f9d002bd91",
        "quality": "720p",
    },
    {
        "msg_id": 37733,
        "title": "Puss in Boots: The Last Wish",
        "movie_id": "126e87da-ef9e-4b9e-b331-c916a01be11c",
        "quality": "720p",
    },
    {
        "msg_id": 37734,
        "title": "The Bad Guys 2",
        "movie_id": "5f2fbaaa-0e2a-45d0-b618-d62f9c976819",
        "quality": "720p",
    },
]


def execute_sql(sql_query, params=None):
    script = f"""
    const {{ neon }} = require('@neondatabase/serverless');
    require('dotenv').config({{ path: '{PROJECT_DIR}/.env' }});
    const sql = neon(process.env.DATABASE_URL);
    async function run() {{
        const params = {json.dumps(params or [])};
        const res = await sql.query({json.dumps(sql_query)}, params);
        console.log(JSON.stringify(res));
    }}
    run().catch(err => {{ console.error(err); process.exit(1); }});
    """
    res = subprocess.run(["node", "-e", script], cwd=str(PROJECT_DIR), capture_output=True, text=True, check=True, env=os.environ)
    for line in res.stdout.strip().splitlines():
        line = line.strip()
        if line.startswith("[") or line.startswith("{"):
            return json.loads(line)
    return []


async def download_tg_file(client, msg_id, out_dir):
    msg = await client.get_messages("me", ids=msg_id)
    if not msg or not msg.file:
        raise RuntimeError(f"Message {msg_id} has no downloadable file")

    orig_name = msg.file.name or f"file_{msg_id}.mkv"
    target_path = out_dir / f"{msg_id}_{orig_name}"
    part_path = target_path.with_suffix(".part")

    expected_size = msg.file.size
    chunk_size = 1024 * 1024
    offset = 0

    if part_path.exists():
        offset = (part_path.stat().st_size // chunk_size) * chunk_size
        with open(part_path, "r+b") as f:
            f.truncate(offset)

    log.info(f"Downloading {target_path.name} ({expected_size / (1024*1024):.1f} MB)...")
    downloaded = offset
    with open(part_path, "ab") as f:
        async for chunk in client.iter_download(msg.media, offset=offset, request_size=chunk_size):
            f.write(chunk)
            downloaded += len(chunk)
            pct = int(downloaded * 100 / expected_size) if expected_size else 0
            print(f"\r  Download: {pct}% ({downloaded // (1024*1024)}/{expected_size // (1024*1024)} MB)", end="", flush=True)
    print()

    if part_path.stat().st_size != expected_size:
        raise IOError(f"Size mismatch: expected {expected_size}, got {part_path.stat().st_size}")

    os.replace(part_path, target_path)
    log.info(f"Download complete: {target_path.name}")
    return target_path


def check_and_convert_video(input_video, output_dir, safe_name):
    """Inspect video codec:
    If already H.264 with AAC in mp4 -> remux / faststart.
    If H.264 in mkv -> copy streams into mp4.
    If HEVC / other -> transcode to libx264 fast.
    """
    cmd_probe = [
        "ffprobe", "-v", "error",
        "-show_entries", "stream=index,codec_name,codec_type",
        "-of", "json", str(input_video)
    ]
    res = subprocess.run(cmd_probe, capture_output=True, text=True, check=True)
    info = json.loads(res.stdout)

    v_codec = None
    a_codec = None
    for s in info.get("streams", []):
        if s.get("codec_type") == "video" and not v_codec:
            v_codec = s.get("codec_name")
        elif s.get("codec_type") == "audio" and not a_codec:
            a_codec = s.get("codec_name")

    log.info(f"Detected codecs: Video={v_codec}, Audio={a_codec}")
    out_mp4 = output_dir / f"{safe_name}.mp4"

    # If already H.264 and AAC -> just remux to MP4 faststart without re-encoding!
    if v_codec in ("h264", "avc") and a_codec == "aac":
        log.info(f"Video is already H.264/AAC! Remuxing into clean MP4 container (Instant)...")
        cmd_remux = [
            "ffmpeg", "-y",
            "-i", str(input_video),
            "-map", "0:v:0",
            "-map", "0:a:0",
            "-c", "copy",
            "-movflags", "+faststart",
            str(out_mp4)
        ]
        subprocess.run(cmd_remux, check=True)
    else:
        log.info(f"Video is {v_codec}. Transcoding to H.264 (preset=veryfast, crf=22)...")
        cmd_transcode = [
            "ffmpeg", "-y",
            "-threads", "4",
            "-i", str(input_video),
            "-map", "0:v:0",
            "-map", "0:a:0",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "22",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            str(out_mp4)
        ]
        subprocess.run(cmd_transcode, check=True)

    log.info(f"Output ready: {out_mp4.name} ({out_mp4.stat().st_size / (1024*1024):.1f} MB)")
    return out_mp4


class ProgressReader:
    def __init__(self, path):
        self.path = path
        self.total = path.stat().st_size
        self._f = open(path, "rb")
        self.read_bytes = 0
        self.last_pct = -1

    def read(self, size=-1):
        chunk = self._f.read(size)
        if chunk:
            self.read_bytes += len(chunk)
            pct = int(self.read_bytes * 100 / self.total) if self.total else 100
            if pct != self.last_pct and pct % 10 == 0:
                self.last_pct = pct
                print(f"\r  Upload: {pct}% ({self.read_bytes // (1024*1024)}/{self.total // (1024*1024)} MB)", end="", flush=True)
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self._f.close()


def upload_pixeldrain(file_path):
    file_name = file_path.name
    log.info(f"Uploading {file_name} to Pixeldrain...")
    url = f"https://pixeldrain.com/api/file/{requests.utils.quote(file_name)}"
    with ProgressReader(file_path) as reader:
        resp = requests.put(url, data=reader, auth=("", PIXELDRAIN_API_KEY), timeout=(30, 3600))
    print()

    if resp.status_code == 201:
        data = resp.json()
        fid = data["id"]
        log.info(f"Pixeldrain upload success: {file_name} -> ID: {fid}")
        return fid
    raise RuntimeError(f"Pixeldrain upload failed: HTTP {resp.status_code} {resp.text}")


def save_to_database(movie_id, video_fid, quality="720p"):
    video_url = f"https://pixeldrain.com/api/file/{video_fid}"
    source_query = """
    INSERT INTO sources (movie_id, label, kind, url, quality, sort_order, is_active, audio_language)
    VALUES ($1, $2, 'direct', $3, $4, 1, true, 'si')
    RETURNING id;
    """
    label = f"Pixeldrain {quality} (Sinhala Dubbed)"
    execute_sql(source_query, [movie_id, label, video_url, quality])
    log.info(f"Inserted DB movie source: {label} ({video_url}) for movie {movie_id}")

    execute_sql("UPDATE movies SET is_published = true WHERE id = $1;", [movie_id])
    log.info(f"Marked movie {movie_id} as published.")


async def process_all():
    client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        log.critical("Telegram client is not authorized!")
        return

    log.info(f"Starting processing queue of {len(QUEUE)} kids movies from @Oshan2k02...")

    for item in QUEUE:
        title = item["title"]
        msg_id = item["msg_id"]
        movie_id = item["movie_id"]
        quality = item["quality"]

        log.info("=" * 60)
        log.info(f"STARTING: {title} (Msg ID: {msg_id})")
        log.info("=" * 60)

        # Check if source already exists
        existing = execute_sql("SELECT id FROM sources WHERE movie_id = $1;", [movie_id])
        if existing:
            log.info(f"Movie '{title}' already has sources in DB. Skipping.")
            continue

        raw_video = None
        mp4_video = None

        try:
            # 1. Download
            raw_video = await download_tg_file(client, msg_id, DOWNLOAD_DIR)

            # 2. Check type and convert/remux
            safe_name = "".join(c if c.isalnum() or c in " ._-" else "_" for c in title)
            mp4_video = check_and_convert_video(raw_video, CONVERT_DIR, safe_name)

            # 3. Upload to Pixeldrain
            video_fid = upload_pixeldrain(mp4_video)

            # 4. Save to DB
            save_to_database(movie_id, video_fid, quality)

            log.info(f"SUCCESS: Movie '{title}' processed and added to database!")

        finally:
            # 5. Clean up local files immediately
            log.info("Cleaning up local files...")
            if raw_video and raw_video.exists():
                raw_video.unlink(missing_ok=True)
            if mp4_video and mp4_video.exists():
                mp4_video.unlink(missing_ok=True)
            log.info(f"Local files deleted. Disk free: {shutil.disk_usage('/')[2] // (1024**3)} GB")

    await client.disconnect()
    log.info("ALL KIDS MOVIES PROCESSED SUCCESSFULLY!")


if __name__ == "__main__":
    asyncio.run(process_all())
