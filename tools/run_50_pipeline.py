#!/usr/bin/env python3
"""Automated End-to-End Media Ingestion & Publishing Pipeline for 50 Movies."""

import asyncio
import errno
import json
import logging
import os
import re
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.errors import FileReferenceExpiredError, FloodWaitError, RPCError

load_dotenv("/home/ubuntu/PROJECTS/evolix-2.0/tools/.env")

API_ID = os.getenv("API_ID")
API_HASH = os.getenv("API_HASH")
SESSION = "/home/ubuntu/PROJECTS/evolix-2.0/tools/session"
PIXELDRAIN_API_KEY = os.getenv("PIXELDRAIN_API_KEY")

SAVE_DIR = Path("/home/ubuntu/PROJECTS/evolix-2.0/tools/downloads")
SAVE_DIR.mkdir(parents=True, exist_ok=True)

CHUNK = 1024 * 1024  # 1 MB
MAX_RETRIES = 5

BASE_URL = "https://evolix-mu.vercel.app"
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL")
ADMIN_PASS = os.getenv("ADMIN_PASS")

PROGRESS_FILE = Path("/home/ubuntu/PROJECTS/evolix-2.0/tools/pipeline_50_progress.json")
CANDIDATES_FILE = Path("/home/ubuntu/PROJECTS/evolix-2.0/tools/verified_50_movies.json")

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("pipeline_50.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout)
    ]
)
log = logging.getLogger("pipeline")


class EvolixClient:
    def __init__(self):
        self.session = requests.Session()
        self.logged_in = False

    def login(self):
        r = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASS
        })
        if not r.ok:
            raise RuntimeError(f"Login failed: {r.status_code} {r.text}")
        me = self.session.get(f"{BASE_URL}/api/auth/me").json()
        if not me.get("isAdmin"):
            raise RuntimeError("Logged-in user is not admin")
        self.logged_in = True
        log.info("Authenticated successfully with Evolix Admin API")

    def ensure_auth(self):
        if not self.logged_in:
            self.login()

    def create_movie(self, movie_prefill):
        self.ensure_auth()
        movie_prefill["isPublished"] = True
        r = self.session.post(f"{BASE_URL}/api/admin/movies", json=movie_prefill)
        if r.status_code == 201:
            return r.json()["movie"]["id"]
        elif r.status_code == 409:
            # Already exists
            return r.json().get("id")
        elif r.status_code == 401:
            self.login()
            return self.create_movie(movie_prefill)
        else:
            raise RuntimeError(f"Create movie error {r.status_code}: {r.text}")

    def attach_source(self, movie_id, download_url, quality):
        self.ensure_auth()
        # Check existing
        srcs = self.session.get(f"{BASE_URL}/api/admin/sources", params={"movieId": movie_id}).json().get("sources", [])
        for s in srcs:
            if s.get("url") == download_url:
                log.info("Source already attached: %s", s["id"])
                return s["id"]

        payload = {
            "movieId": movie_id,
            "label": f"Pixeldrain {quality} (Sinhala Dubbed)",
            "kind": "direct",
            "url": download_url,
            "quality": quality,
            "isActive": True,
            "sortOrder": 0
        }
        r = self.session.post(f"{BASE_URL}/api/admin/sources", json=payload)
        if r.status_code == 201:
            return r.json()["source"]["id"]
        elif r.status_code == 401:
            self.login()
            return self.attach_source(movie_id, download_url, quality)
        else:
            raise RuntimeError(f"Attach source error {r.status_code}: {r.text}")


class ProgressReader:
    def __init__(self, file_path, callback=None):
        self.file_path = file_path
        self.total_size = file_path.stat().st_size
        self._f = open(file_path, "rb")
        self.bytes_read = 0
        self.callback = callback

    def read(self, size=-1):
        chunk = self._f.read(size)
        if chunk:
            self.bytes_read += len(chunk)
            if self.callback:
                self.callback(self.bytes_read, self.total_size)
        return chunk

    def __len__(self):
        return self.total_size

    def close(self):
        self._f.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


def upload_to_pixeldrain(file_path: Path):
    file_name = file_path.name
    file_size = file_path.stat().st_size
    url_name = requests.utils.quote(file_name)
    upload_url = f"https://pixeldrain.com/api/file/{url_name}"

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            log.info("UPLOAD %s (attempt %d/%d, %.1f MB)", file_name, attempt, MAX_RETRIES, file_size / (1024 * 1024))
            last_pct = -1

            def on_progress(current, total):
                nonlocal last_pct
                pct = int(current * 100 / total) if total else 0
                if pct != last_pct and pct % 5 == 0:
                    last_pct = pct
                    print(f"\r  Upload: {pct}% ({current // (1024*1024)}/{total // (1024*1024)} MB)", end="", flush=True)

            with ProgressReader(file_path, callback=on_progress) as reader:
                resp = requests.put(
                    upload_url,
                    data=reader,
                    auth=("", PIXELDRAIN_API_KEY),
                    headers={"Content-Length": str(file_size)},
                    timeout=(30, 900)
                )
            print()

            if resp.status_code == 201:
                file_id = resp.json().get("id")
                log.info("UPLOAD SUCCESS %s -> ID: %s", file_name, file_id)
                return {
                    "id": file_id,
                    "url": f"https://pixeldrain.com/u/{file_id}",
                    "download_url": f"https://pixeldrain.com/api/file/{file_id}?download"
                }
            elif resp.status_code == 429:
                log.warning("Pixeldrain 429 rate limit, sleeping 15s...")
                time.sleep(15)
            else:
                log.error("Pixeldrain error HTTP %d: %s", resp.status_code, resp.text)
        except Exception as e:
            delay = min(2 ** attempt, 60)
            log.warning("Upload network error: %r (retrying in %ds)", e, delay)
            time.sleep(delay)

    raise RuntimeError(f"Failed to upload {file_name} after {MAX_RETRIES} attempts")


async def download_telegram_movie(client, entity, msg_id, target_path: Path):
    part = target_path.with_name(target_path.name + ".part")
    
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            msg = await client.get_messages(entity, ids=msg_id)
            if not msg or not msg.file:
                raise ValueError(f"Message {msg_id} has no file")
            
            expected = msg.file.size
            if target_path.exists() and target_path.stat().st_size == expected:
                log.info("Already downloaded on disk: %s", target_path.name)
                return target_path

            offset = 0
            if part.exists():
                offset = (part.stat().st_size // CHUNK) * CHUNK
                with open(part, "r+b") as f:
                    f.truncate(offset)

            log.info("DOWNLOAD %s (attempt %d/%d, resume %d/%d MB)",
                     target_path.name, attempt, MAX_RETRIES, offset // CHUNK, expected // CHUNK)

            downloaded = offset
            last_pct = -1
            with open(part, "ab") as f:
                async for chunk in client.iter_download(msg.media, offset=offset, request_size=CHUNK):
                    f.write(chunk)
                    downloaded += len(chunk)
                    pct = int(downloaded * 100 / expected) if expected else 0
                    if pct != last_pct and pct % 5 == 0:
                        last_pct = pct
                        print(f"\r  Download: {pct}% ({downloaded // CHUNK}/{expected // CHUNK} MB)", end="", flush=True)
            print()

            if part.stat().st_size != expected:
                raise IOError(f"Size mismatch: {part.stat().st_size} vs expected {expected}")

            os.replace(part, target_path)
            log.info("DOWNLOAD COMPLETE %s", target_path.name)
            return target_path

        except FloodWaitError as e:
            log.warning("FloodWait %ds, sleeping...", e.seconds + 1)
            await asyncio.sleep(e.seconds + 1)
        except FileReferenceExpiredError:
            log.warning("FileReference expired for msg %d, refreshing message...", msg_id)
            await asyncio.sleep(2)
        except Exception as e:
            delay = min(2 ** attempt, 60)
            log.warning("Download error on msg %d: %r (retry in %ds)", msg_id, e, delay)
            await asyncio.sleep(delay)

    raise RuntimeError(f"Failed to download msg {msg_id} after {MAX_RETRIES} attempts")


def load_progress():
    if PROGRESS_FILE.exists():
        try:
            return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"completed": []}


def save_progress(progress):
    tmp = PROGRESS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(progress, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, PROGRESS_FILE)


async def run_pipeline():
    log.info("=" * 60)
    log.info("STARTING 50 MOVIES INGESTION PIPELINE")
    log.info("=" * 60)

    evolix = EvolixClient()
    evolix.login()

    progress = load_progress()
    done_tmdb = {item["tmdb_id"] for item in progress.get("completed", [])}
    log.info("Previously completed in this run: %d movies", len(done_tmdb))

    with open(CANDIDATES_FILE, encoding="utf-8") as f:
        movies_list = json.load(f)

    # Process exactly 50 movies
    target_movies = movies_list[:50]
    log.info("Total target movies in queue: %d", len(target_movies))

    async with TelegramClient(SESSION, int(API_ID), API_HASH) as client:
        entity = await client.get_entity("sinhalaaaa")

        for idx, item in enumerate(target_movies, 1):
            tmdb_id = item["tmdb_id"]
            title = item["tmdb_title"]
            msg_id = item["msg_id"]
            file_name = item["file_name"]
            quality = item["quality"]

            if tmdb_id in done_tmdb:
                log.info("[%d/50] SKIP (already processed): %s", idx, title)
                continue

            log.info("\n" + "=" * 50)
            log.info("[%d/50] PROCESSING: %s (%s) [TMDB: %d, Msg: %d]",
                     idx, title, item.get("tmdb_year"), tmdb_id, msg_id)
            log.info("=" * 50)

            target_path = SAVE_DIR / file_name

            # 1. Download
            await download_telegram_movie(client, entity, msg_id, target_path)

            # 2. Upload to Pixeldrain
            upload_info = await asyncio.to_thread(upload_to_pixeldrain, target_path)

            # 3. Create on Evolix & Attach Source
            log.info("INGESTING TO EVOLIX: %s", title)
            movie_id = await asyncio.to_thread(evolix.create_movie, item["prefill"])
            source_id = await asyncio.to_thread(
                evolix.attach_source,
                movie_id,
                upload_info["download_url"],
                quality
            )
            log.info("PUBLISHED: %s -> Evolix Movie ID: %s, Source: %s", title, movie_id, source_id)

            # 4. Clean up local disk
            if target_path.exists():
                size_mb = target_path.stat().st_size / (1024 * 1024)
                target_path.unlink()
                log.info("CLEANUP: Deleted %s from disk (freed %.1f MB)", target_path.name, size_mb)

            # 5. Record progress
            record = {
                "tmdb_id": tmdb_id,
                "title": title,
                "year": item.get("tmdb_year"),
                "movie_id": movie_id,
                "source_id": source_id,
                "pixeldrain_id": upload_info["id"],
                "pixeldrain_url": upload_info["url"],
                "quality": quality,
                "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }
            progress["completed"].append(record)
            done_tmdb.add(tmdb_id)
            save_progress(progress)
            log.info("[%d/50] SUCCESS: %s fully processed and published!", idx, title)

    log.info("\n" + "=" * 60)
    log.info("PIPELINE COMPLETE: All 50 movies ingested and published!")
    log.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(run_pipeline())
