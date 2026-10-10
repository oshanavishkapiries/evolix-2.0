#!/usr/bin/env python3
"""Upload videos and subtitles to Pixeldrain with retry mechanism, progress tracking, and list creation."""

import argparse
import json
import logging
import os
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("PIXELDRAIN_API_KEY")
VIDEO_DIR = Path(os.getenv("SAVE_DIR", "downloads"))
SUBTITLE_DIR = Path(os.getenv("SUBTITLE_DIR", "subtitles"))
OUTPUT_JSON = Path("pixeldrain_uploads.json")
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "5"))

log = logging.getLogger("px_upload")


def setup_logging():
    log.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s")

    fh = RotatingFileHandler("pixeldrain_uploader.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)

    log.addHandler(fh)
    log.addHandler(sh)


class ProgressReader:
    """Wraps an open file to report transfer progress during requests streaming."""
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


def load_manifest(path):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.warning("Existing %s was corrupted, creating a new manifest", path)
    return {
        "list_title": "Better Call Saul - Season 1",
        "list_id": None,
        "list_url": None,
        "total_files": 0,
        "total_size_bytes": 0,
        "files": []
    }


def save_manifest(manifest, path):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def verify_remote_file(file_id, api_key):
    """Check if file still exists on Pixeldrain."""
    url = f"https://pixeldrain.com/api/file/{file_id}/info"
    try:
        r = requests.get(url, auth=("", api_key), timeout=15)
        if r.status_code == 200:
            return r.json().get("success", False)
    except requests.RequestException:
        pass
    return False


def upload_single_file(file_path, api_key, max_retries=MAX_RETRIES):
    """Upload a single file to Pixeldrain via PUT /api/file/{name} with retry and exponential backoff."""
    file_name = file_path.name
    total_size = file_path.stat().st_size
    encoded_name = urllib.parse.quote(file_name)
    upload_url = f"https://pixeldrain.com/api/file/{encoded_name}"

    for attempt in range(1, max_retries + 1):
        last_pct = -1

        def on_progress(current, total):
            nonlocal last_pct
            pct = int(current * 100 / total) if total else 100
            if pct != last_pct:
                last_pct = pct
                cur_mb = current / (1024 * 1024)
                tot_mb = total / (1024 * 1024)
                print(f"\r  {pct:3d}%  {cur_mb:.1f}/{tot_mb:.1f} MB", end="", flush=True)

        try:
            log.info("UPLOADING %s (attempt %d/%d, %.1f MB)",
                     file_name, attempt, max_retries, total_size / (1024 * 1024))

            with ProgressReader(file_path, on_progress) as reader:
                resp = requests.put(
                    upload_url,
                    data=reader,
                    auth=("", api_key),
                    timeout=(30, 300),  # (connect timeout, read timeout)
                )

            print()  # newline after progress

            if resp.status_code == 201:
                data = resp.json()
                file_id = data.get("id")
                log.info("SUCCESS %s -> ID: %s", file_name, file_id)
                return {
                    "name": file_name,
                    "size": total_size,
                    "id": file_id,
                    "url": f"https://pixeldrain.com/u/{file_id}",
                    "download_url": f"https://pixeldrain.com/api/file/{file_id}?download",
                    "uploaded_at": datetime.now(timezone.utc).isoformat(),
                }
            elif resp.status_code == 429:
                log.warning("Rate limited (HTTP 429). Backing off...")
                time.sleep(15)
            elif resp.status_code >= 400:
                log.error("Upload error HTTP %d: %s", resp.status_code, resp.text)
                if resp.status_code == 401:
                    log.critical("Authentication failed. Invalid API key.")
                    return None
        except (requests.RequestException, IOError) as e:
            print()
            delay = min(2 ** attempt, 60)
            log.warning("Network/IO Error uploading %s: %s (retry in %ds)", file_name, e, delay)
            time.sleep(delay)

    log.error("FAILED %s after %d attempts", file_name, max_retries)
    return None


def create_pixeldrain_list(title, file_ids, api_key):
    """Bundle uploaded file IDs into a Pixeldrain List (folder view)."""
    url = "https://pixeldrain.com/api/list"
    payload = {
        "title": title,
        "anonymous": False,
        "files": [{"id": fid} for fid in file_ids]
    }
    try:
        r = requests.post(url, json=payload, auth=("", api_key), timeout=30)
        if r.status_code == 201:
            data = r.json()
            list_id = data.get("id")
            log.info("CREATED LIST: %s (ID: %s, URL: https://pixeldrain.com/l/%s)",
                     title, list_id, list_id)
            return list_id, f"https://pixeldrain.com/l/{list_id}"
        else:
            log.error("Failed to create list: HTTP %d %s", r.status_code, r.text)
    except requests.RequestException as e:
        log.error("Error creating list: %s", e)
    return None, None


def main():
    setup_logging()
    p = argparse.ArgumentParser(description="Upload media and subtitles to Pixeldrain")
    p.add_argument("--api-key", help="Pixeldrain API key (default: from .env)")
    p.add_argument("--video-dir", type=Path, default=VIDEO_DIR, help="directory containing video files")
    p.add_argument("--subtitle-dir", type=Path, default=SUBTITLE_DIR, help="directory containing subtitle files")
    p.add_argument("--output-json", type=Path, default=OUTPUT_JSON, help="file to save upload links")
    p.add_argument("--list-title", default="Better Call Saul - Season 1", help="title for the Pixeldrain album/list")
    p.add_argument("--dry-run", action="store_true", help="list files to be uploaded without uploading")
    p.add_argument("--no-subs", action="store_true", help="skip uploading subtitle files")
    p.add_argument("--no-videos", action="store_true", help="skip uploading video files")
    args = p.parse_args()

    api_key = args.api_key or API_KEY
    if not api_key:
        log.error("PIXELDRAIN_API_KEY is not set in .env or via --api-key")
        sys.exit(1)

    # Gather files
    items_to_upload = []

    if not args.no_videos and args.video_dir.exists():
        video_exts = {".mkv", ".mp4", ".avi", ".mov", ".webm"}
        videos = sorted([f for f in args.video_dir.iterdir() if f.is_file() and f.suffix.lower() in video_exts])
        for v in videos:
            items_to_upload.append({"path": v, "type": "video"})

    if not args.no_subs and args.subtitle_dir.exists():
        sub_exts = {".srt", ".vtt", ".ass"}
        subs = sorted([f for f in args.subtitle_dir.iterdir() if f.is_file() and f.suffix.lower() in sub_exts])
        for s in subs:
            items_to_upload.append({"path": s, "type": "subtitle"})

    if not items_to_upload:
        log.warning("No files found to upload in %s or %s", args.video_dir, args.subtitle_dir)
        sys.exit(0)

    total_bytes = sum(item["path"].stat().st_size for item in items_to_upload)
    log.info("Found %d file(s) to process (Total size: %.2f GB)",
             len(items_to_upload), total_bytes / (1024 ** 3))

    if args.dry_run:
        for idx, item in enumerate(items_to_upload, 1):
            sz_mb = item["path"].stat().st_size / (1024 * 1024)
            log.info("[%2d/%2d] [%s] %.1f MB - %s",
                     idx, len(items_to_upload), item["type"].upper(), sz_mb, item["path"].name)
        log.info("Dry run complete: %d files ready for upload", len(items_to_upload))
        sys.exit(0)

    # Load existing upload manifest
    manifest = load_manifest(args.output_json)
    existing_map = {f["name"]: f for f in manifest.get("files", [])}

    uploaded_ids = []
    failed_files = []

    for idx, item in enumerate(items_to_upload, 1):
        fpath = item["path"]
        fname = fpath.name
        fsize = fpath.stat().st_size

        log.info("[%d/%d] Processing %s (%s)", idx, len(items_to_upload), fname, item["type"])

        # Check if already uploaded and valid
        if fname in existing_map:
            cached = existing_map[fname]
            if cached.get("size") == fsize and cached.get("id"):
                if verify_remote_file(cached["id"], api_key):
                    log.info("SKIP (already uploaded) %s -> %s", fname, cached["url"])
                    uploaded_ids.append(cached["id"])
                    continue
                else:
                    log.warning("Cached file ID %s invalid on remote, re-uploading...", cached["id"])

        info = upload_single_file(fpath, api_key)
        if info:
            info["type"] = item["type"]
            existing_map[fname] = info
            manifest["files"] = list(existing_map.values())
            manifest["total_files"] = len(manifest["files"])
            manifest["total_size_bytes"] = sum(f.get("size", 0) for f in manifest["files"])
            save_manifest(manifest, args.output_json)
            uploaded_ids.append(info["id"])
        else:
            failed_files.append(fname)

    # Create/Update Pixeldrain List if files were uploaded
    if uploaded_ids:
        log.info("Creating / Updating Pixeldrain album list with %d files...", len(uploaded_ids))
        list_id, list_url = create_pixeldrain_list(args.list_title, uploaded_ids, api_key)
        if list_id:
            manifest["list_id"] = list_id
            manifest["list_url"] = list_url
            manifest["list_title"] = args.list_title
            save_manifest(manifest, args.output_json)

    log.info("=" * 60)
    log.info("Upload process finished!")
    log.info("Total Uploaded Files: %d", len(manifest.get("files", [])))
    if manifest.get("list_url"):
        log.info("Folder/List URL: %s", manifest["list_url"])
    log.info("Manifest saved to: %s", args.output_json)
    if failed_files:
        log.error("Failed files: %s", failed_files)
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
