#!/usr/bin/env python3
"""Automated pipeline for processing Narcos (Seasons 1-3, 30 episodes):
Download from Telegram -> Extract Sinhala/English subs -> Transcode to x264 .mp4 ->
Upload to Pixeldrain -> Insert sources/subtitles in DB -> Set visibility -> Clean local files.
"""

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from telethon import TelegramClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("pipeline_narcos.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("narcos_pipeline")

TOOLS_DIR = Path(__file__).resolve().parent
PROJECT_DIR = TOOLS_DIR.parent
load_dotenv(TOOLS_DIR / ".env")
load_dotenv(PROJECT_DIR / ".env")

API_ID = int(os.getenv("API_ID"))
API_HASH = os.getenv("API_HASH")
SESSION_NAME = str(TOOLS_DIR / os.getenv("SESSION_NAME", "session"))
PIXELDRAIN_API_KEY = os.getenv("PIXELDRAIN_API_KEY")
CHANNEL = -1001767821709  # Narcos channel
SHOW_ID = "15a2f2be-e71b-41fd-83c2-a465b9ffd0f9"  # Narcos show ID

DOWNLOAD_DIR = TOOLS_DIR / "downloads"
SUB_DIR = TOOLS_DIR / "subtitles"
CONVERT_DIR = TOOLS_DIR / "converted"

for d in (DOWNLOAD_DIR, SUB_DIR, CONVERT_DIR):
    d.mkdir(parents=True, exist_ok=True)


def execute_sql(sql_query, params=None):
    """Run SQL query against Neon Postgres using node / @neondatabase/serverless."""
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


def get_episodes_mapping():
    """Fetch all episodes for Narcos from DB and map them to Telegram message IDs."""
    sql_text = """
    SELECT sea.season_number, e.episode_number, e.id as ep_id, e.name as title
    FROM seasons sea
    JOIN episodes e ON e.season_id = sea.id
    WHERE sea.show_id = $1
    ORDER BY sea.season_number, e.episode_number;
    """
    db_eps = execute_sql(sql_text, [SHOW_ID])
    log.info(f"Loaded {len(db_eps)} episodes from DB for Narcos")

    # In Telegram channel:
    # S01: Msg 33 -> Ep 1 .. Msg 42 -> Ep 10 (mid = 32 + ep)
    # S02: Msg 43 -> Ep 1 .. Msg 52 -> Ep 10 (mid = 42 + ep)
    # S03: Msg 53 -> Ep 1 .. Msg 62 -> Ep 10 (mid = 52 + ep)
    queue = []
    for item in db_eps:
        s_num = item["season_number"]
        e_num = item["episode_number"]
        if s_num == 1:
            msg_id = 32 + e_num
        elif s_num == 2:
            msg_id = 42 + e_num
        elif s_num == 3:
            msg_id = 52 + e_num
        else:
            continue
        
        queue.append({
            "season": s_num,
            "ep": e_num,
            "msg_id": msg_id,
            "ep_id": item["ep_id"],
            "title": item["title"],
        })
    return queue


async def download_tg_file(client, entity, msg_id, out_dir):
    """Download a single message media file with retry and chunk progress."""
    msg = await client.get_messages(entity, ids=msg_id)
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


def extract_subtitles(video_path, sub_out_dir, season_num, ep_num):
    """Inspect and extract Sinhala ('sin') and English ('eng') subtitles as .srt."""
    cmd_probe = [
        "ffprobe", "-v", "error",
        "-show_entries", "stream=index,codec_name,codec_type:stream_tags=language,title",
        "-of", "json", str(video_path)
    ]
    res = subprocess.run(cmd_probe, capture_output=True, text=True, check=True)
    info = json.loads(res.stdout)

    extracted = {}
    for stream in info.get("streams", []):
        if stream.get("codec_type") != "subtitle":
            continue
        idx = stream["index"]
        tags = stream.get("tags") or {}
        lang = (tags.get("language") or "").strip().lower()
        title = (tags.get("title") or "").lower()

        is_sin = lang in ("sin", "sinhala", "snh") or "sinhala" in title
        is_eng = lang in ("eng", "english", "en") or "english" in title

        target_lang = None
        if is_sin and "sin" not in extracted:
            target_lang = "sin"
        elif is_eng and "eng" not in extracted:
            target_lang = "eng"

        if target_lang:
            out_file = sub_out_dir / f"Narcos.S{season_num:02d}E{ep_num:02d}.{target_lang}.srt"
            cmd_extract = [
                "ffmpeg", "-y", "-i", str(video_path),
                "-map", f"0:{idx}",
                "-c:s", "srt",
                str(out_file)
            ]
            subprocess.run(cmd_extract, capture_output=True, text=True, check=True)
            log.info(f"Extracted {target_lang.upper()} subtitle: {out_file.name}")
            extracted[target_lang] = out_file

    return extracted


def transcode_to_x264_mp4(input_video, output_dir, season_num, ep_num):
    """Transcode MKV to H.264 (libx264) + AAC in MP4 container with faststart."""
    out_mp4 = output_dir / f"Narcos.S{season_num:02d}E{ep_num:02d}.720p.mp4"
    log.info(f"Transcoding to H.264 MP4: {out_mp4.name} (preset=veryfast, crf=22)...")

    cmd = [
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
    subprocess.run(cmd, check=True)
    log.info(f"Transcode complete: {out_mp4.name} ({out_mp4.stat().st_size / (1024*1024):.1f} MB)")
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
    """Upload file to Pixeldrain API."""
    file_name = file_path.name
    log.info(f"Uploading {file_name} to Pixeldrain...")
    url = f"https://pixeldrain.com/api/file/{requests.utils.quote(file_name)}"
    with ProgressReader(file_path) as reader:
        resp = requests.put(url, data=reader, auth=("", PIXELDRAIN_API_KEY), timeout=(30, 1800))
    print()

    if resp.status_code == 201:
        data = resp.json()
        fid = data["id"]
        log.info(f"Pixeldrain upload success: {file_name} -> ID: {fid}")
        return fid
    raise RuntimeError(f"Pixeldrain upload failed: HTTP {resp.status_code} {resp.text}")


def save_to_database(ep_id, video_fid, subs_fids):
    """Insert source and subtitles in Postgres, set visibility to true."""
    video_url = f"https://pixeldrain.com/api/file/{video_fid}"
    source_query = """
    INSERT INTO sources (episode_id, label, kind, url, quality, sort_order, is_active, audio_language)
    VALUES ($1, 'Pixeldrain (720p)', 'direct', $2, '720p', 1, true, '')
    RETURNING id;
    """
    execute_sql(source_query, [ep_id, video_url])
    log.info(f"Inserted DB source: {video_url} for episode {ep_id}")

    for lang, fid in subs_fids.items():
        sub_url = f"https://pixeldrain.com/api/file/{fid}"
        label = "Sinhala" if lang == "sin" else "English"
        sub_query = """
        INSERT INTO subtitles (episode_id, label, language, url, format, sort_order)
        VALUES ($1, $2, $3, $4, 'srt', 1)
        RETURNING id;
        """
        execute_sql(sub_query, [ep_id, label, lang, sub_url])
        log.info(f"Inserted DB subtitle ({label}): {sub_url} for episode {ep_id}")

    execute_sql("UPDATE episodes SET is_visible = true WHERE id = $1;", [ep_id])
    execute_sql("UPDATE shows SET is_published = true WHERE id = $1;", [SHOW_ID])
    log.info(f"Updated DB visibility: episode {ep_id} visible, series {SHOW_ID} published.")


async def process_all():
    client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        log.critical("Telegram client is not authorized!")
        return

    channel_entity = await client.get_entity(CHANNEL)
    log.info(f"Connected to Telegram channel: {channel_entity.title}")

    queue = get_episodes_mapping()

    for item in queue:
        s_num = item["season"]
        ep_num = item["ep"]
        msg_id = item["msg_id"]
        ep_id = item["ep_id"]
        title = item["title"]

        log.info("=" * 60)
        log.info(f"STARTING S{s_num:02d}E{ep_num:02d}: {title} (Msg ID: {msg_id})")
        log.info("=" * 60)

        existing = execute_sql("SELECT id FROM sources WHERE episode_id = $1;", [ep_id])
        if existing:
            log.info(f"Episode S{s_num:02d}E{ep_num:02d} already has sources in DB. Skipping.")
            continue

        raw_video = None
        mp4_video = None
        extracted_subs = {}

        try:
            # 1. Download
            raw_video = await download_tg_file(client, channel_entity, msg_id, DOWNLOAD_DIR)

            # 2. Extract Subtitles
            extracted_subs = extract_subtitles(raw_video, SUB_DIR, s_num, ep_num)
            if not extracted_subs:
                log.warning(f"No Sinhala or English subtitles found in S{s_num:02d}E{ep_num:02d}!")

            # 3. Transcode to x264 .mp4
            mp4_video = transcode_to_x264_mp4(raw_video, CONVERT_DIR, s_num, ep_num)

            # 4. Upload video to Pixeldrain
            video_fid = upload_pixeldrain(mp4_video)

            # 5. Upload subtitles to Pixeldrain
            subs_fids = {}
            for lang, sub_path in extracted_subs.items():
                sfid = upload_pixeldrain(sub_path)
                subs_fids[lang] = sfid

            # 6. Save in DB
            save_to_database(ep_id, video_fid, subs_fids)

            log.info(f"SUCCESS: Episode S{s_num:02d}E{ep_num:02d} processed and added to database!")

        finally:
            # 7. Clean up local files immediately
            log.info("Cleaning up local files for this episode...")
            if raw_video and raw_video.exists():
                raw_video.unlink(missing_ok=True)
            if mp4_video and mp4_video.exists():
                mp4_video.unlink(missing_ok=True)
            for sub_p in extracted_subs.values():
                if sub_p.exists():
                    sub_p.unlink(missing_ok=True)
            log.info(f"Local files deleted. Disk free: {shutil.disk_usage('/')[2] // (1024**3)} GB")

    await client.disconnect()
    log.info("ALL 30 NARCOS EPISODES PROCESSED SUCCESSFULLY!")


if __name__ == "__main__":
    asyncio.run(process_all())
