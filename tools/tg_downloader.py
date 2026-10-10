#!/usr/bin/env python3
"""Telegram channel video downloader (resume + retry + size/SHA-256 verify)."""
import argparse
import asyncio
import errno
import hashlib
import json
import logging
import os
import re
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.errors import FloodWaitError, RPCError

load_dotenv()

API_ID = os.getenv("API_ID")
API_HASH = os.getenv("API_HASH")
SESSION = os.getenv("SESSION_NAME", "session")
SAVE_DIR = Path(os.getenv("SAVE_DIR", "downloads"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "5"))
CHUNK = 1024 * 1024  # 1 MB (Telegram max request size)
MANIFEST = SAVE_DIR / "manifest.json"
VIDEO_EXTS = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".wmv", ".flv", ".ts", ".m4v"}

log = logging.getLogger("tgdl")


def setup_logging():
    log.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s")
    fh = RotatingFileHandler("downloader.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    log.addHandler(fh)
    log.addHandler(sh)


def parse_channel(value):
    value = str(value).strip()
    return int(value) if re.fullmatch(r"-?\d+", value) else value


def safe_name(name):
    return re.sub(r'[\\/:*?"<>|]', "_", name)


def is_video(msg):
    if not msg.file:
        return False
    if msg.video:
        return True
    if (
        msg.document
        and msg.document.mime_type
        and msg.document.mime_type.startswith("video/")
    ):
        return True
    ext = (msg.file.ext or "").lower()
    return ext in VIDEO_EXTS


def is_downloadable(msg, all_files=False):
    if not msg.file:
        return False
    if all_files:
        return True
    return is_video(msg)


def get_original_filename(msg):
    if not msg.file:
        return None
    if msg.file.name:
        return msg.file.name
    ext = msg.file.ext or (".mp4" if is_video(msg) else "")
    return ("video_%s%s" % (msg.id, ext)) if is_video(msg) else ("file_%s%s" % (msg.id, ext))


def make_filename(msg):
    orig = get_original_filename(msg) or ("file_%s" % msg.id)
    return safe_name("%s_%s" % (msg.id, orig))


def matches_regex(msg, pattern):
    if pattern is None:
        return True
    orig = get_original_filename(msg) or ""
    final = make_filename(msg)
    return bool(pattern.search(orig) or pattern.search(final))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def load_manifest():
    if MANIFEST.exists():
        try:
            return json.loads(MANIFEST.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("manifest.json corrupted, starting a new one")
    return {}


def save_manifest(manifest):
    tmp = MANIFEST.with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, MANIFEST)


async def download_one(client, msg, manifest):
    expected = msg.file.size
    name = make_filename(msg)
    final = SAVE_DIR / name
    part = final.with_name(final.name + ".part")
    key = str(msg.id)

    # Already downloaded?
    if final.exists() and final.stat().st_size == expected:
        if key not in manifest:
            digest = await asyncio.to_thread(sha256_file, final)
            manifest[key] = {"name": name, "size": expected, "sha256": digest}
            save_manifest(manifest)
        log.info("SKIP (done) %s", name)
        return True

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            # Resume: keep only whole 1 MB blocks of the .part file
            offset = 0
            if part.exists():
                offset = (part.stat().st_size // CHUNK) * CHUNK
                with open(part, "r+b") as f:
                    f.truncate(offset)
            log.info("DOWNLOAD %s (attempt %d/%d, resume from %d MB, total %d MB)",
                     name, attempt, MAX_RETRIES, offset // CHUNK, expected // CHUNK)

            downloaded = offset
            last_pct = -1
            with open(part, "ab") as f:
                async for chunk in client.iter_download(msg.media, offset=offset, request_size=CHUNK):
                    f.write(chunk)
                    downloaded += len(chunk)
                    pct = int(downloaded * 100 / expected) if expected else 0
                    if pct != last_pct:
                        last_pct = pct
                        print("\r  %3d%%  %d/%d MB" % (pct, downloaded // CHUNK, expected // CHUNK),
                              end="", flush=True)
            print()

            # Verify size
            size = part.stat().st_size
            if size != expected:
                if size > expected:
                    part.unlink()
                raise IOError("size mismatch: got %d, expected %d" % (size, expected))

            # Hash and finalize
            digest = await asyncio.to_thread(sha256_file, part)
            os.replace(part, final)
            manifest[key] = {"name": name, "size": expected, "sha256": digest}
            save_manifest(manifest)
            log.info("DONE %s sha256=%s", name, digest)
            return True

        except FloodWaitError as e:
            wait = e.seconds + 1
            log.warning("FloodWait %ds, waiting...", wait)
            await asyncio.sleep(wait)
        except OSError as e:
            if e.errno == errno.ENOSPC:
                log.critical("Disk full, stopping.")
                raise
            await _backoff(name, attempt, e)
        except (asyncio.TimeoutError, RPCError, IOError) as e:
            await _backoff(name, attempt, e)

    log.error("FAILED %s after %d attempts", name, MAX_RETRIES)
    return False


async def _backoff(name, attempt, err):
    delay = min(2 ** attempt, 60)
    log.warning("ERROR %s: %r (retry in %ds)", name, err, delay)
    await asyncio.sleep(delay)


async def verify_all(manifest):
    bad = 0
    for key, info in manifest.items():
        path = SAVE_DIR / info["name"]
        if not path.exists():
            log.error("MISSING %s", info["name"])
            bad += 1
            continue
        if path.stat().st_size != info["size"]:
            log.error("SIZE MISMATCH %s", info["name"])
            bad += 1
            continue
        digest = await asyncio.to_thread(sha256_file, path)
        if digest != info["sha256"]:
            log.error("HASH MISMATCH %s", info["name"])
            bad += 1
        else:
            log.info("OK %s", info["name"])
    log.info("Verify finished: %d problem(s)", bad)
    return bad


async def run(args):
    global SAVE_DIR, MANIFEST
    if args.save_dir:
        SAVE_DIR = Path(args.save_dir)
        MANIFEST = SAVE_DIR / "manifest.json"

    SAVE_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()

    if args.verify:
        return 1 if await verify_all(manifest) else 0

    if not API_ID or not API_HASH:
        log.error("Missing API_ID or API_HASH in .env or environment")
        return 1

    channel_raw = args.channel or os.getenv("CHANNEL")
    if not channel_raw:
        log.error("No channel specified. Set CHANNEL in .env or pass --channel.")
        return 1

    channel = parse_channel(channel_raw)

    regex_pattern = None
    if args.regex:
        flags = 0 if args.case_sensitive else re.IGNORECASE
        try:
            regex_pattern = re.compile(args.regex, flags)
        except re.error as e:
            log.error("Invalid regular expression %r: %s", args.regex, e)
            return 1

    failed = []
    matched = 0

    async with TelegramClient(SESSION, int(API_ID), API_HASH) as client:
        async for _ in client.iter_dialogs():   # cache entities
            pass
        try:
            entity = await client.get_entity(channel)
        except ValueError:
            log.error("Channel not found. Are you a member? Check CHANNEL / ID.")
            return 1
        log.info("Channel: %s", getattr(entity, "title", entity))
        if args.search:
            log.info("Search query: %r", args.search)
        if args.regex:
            log.info("Regex filter: %r (case_sensitive=%s)", args.regex, args.case_sensitive)

        async for msg in client.iter_messages(
            entity,
            limit=args.limit,
            reverse=args.reverse,
            search=args.search,
        ):
            if not is_downloadable(msg, all_files=args.all_files):
                continue
            if not matches_regex(msg, regex_pattern):
                continue

            matched += 1
            name = make_filename(msg)
            size_mb = (msg.file.size or 0) // (1024 * 1024) if msg.file else 0

            if args.dry_run:
                log.info("[MATCH] ID: %s | %d MB | %s", msg.id, size_mb, name)
                continue

            ok = await download_one(client, msg, manifest)
            if not ok:
                failed.append(msg.id)

    if args.dry_run:
        log.info("Dry run complete: %d matching file(s) found", matched)
        return 0

    if failed:
        log.error("Failed message IDs: %s (just run again to retry)", failed)
        return 1
    log.info("All done (processed %d matching file(s))", matched)
    return 0


def main():
    setup_logging()
    p = argparse.ArgumentParser(description="Telegram channel video and file downloader")
    p.add_argument("--channel", help="override CHANNEL from .env")
    p.add_argument("--save-dir", help="override SAVE_DIR from .env")
    p.add_argument("--search", "-s", help="search query for Telegram messages (server-side search)")
    p.add_argument("--regex", "-r", help="regex pattern to filter file names")
    p.add_argument(
        "--case-sensitive",
        action="store_true",
        help="case-sensitive regex matching (default: case-insensitive)",
    )
    p.add_argument(
        "--all-files",
        action="store_true",
        help="allow all file/document types, not only videos",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="list matching files without downloading them",
    )
    p.add_argument("--limit", type=int, default=None, help="number of messages (default: all)")
    p.add_argument("--reverse", action="store_true", help="oldest first")
    p.add_argument("--verify", action="store_true", help="re-check downloaded files against manifest")
    args = p.parse_args()
    try:
        sys.exit(asyncio.run(run(args)))
    except KeyboardInterrupt:
        log.warning("Interrupted. .part files are kept, run again to resume.")
        sys.exit(130)


if __name__ == "__main__":
    main()
