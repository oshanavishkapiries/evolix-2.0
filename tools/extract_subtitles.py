#!/usr/bin/env python3
"""Extract embedded subtitles from video files using ffmpeg and ffprobe."""

import argparse
import json
import logging
import os
import re
import shutil
import subprocess
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DEFAULT_INPUT_DIR = Path(os.getenv("SAVE_DIR", "downloads"))
DEFAULT_OUTPUT_DIR = Path(os.getenv("SUBTITLE_DIR", "subtitles"))
DEFAULT_LANG = os.getenv("SUBTITLE_LANG", "all").strip().lower()
DEFAULT_FORMAT = os.getenv("SUBTITLE_FORMAT", "srt").strip().lower()

VIDEO_EXTS = {".mkv", ".mp4", ".avi", ".mov", ".webm", ".m4v", ".ts"}

log = logging.getLogger("sub_extract")


def setup_logging():
    log.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s")

    fh = RotatingFileHandler("subtitles.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)

    log.addHandler(fh)
    log.addHandler(sh)


def check_dependencies():
    """Verify that ffmpeg and ffprobe are available in PATH."""
    missing = []
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            missing.append(tool)
    if missing:
        log.error("Missing required system tool(s): %s", ", ".join(missing))
        log.error("Please install ffmpeg (e.g. 'sudo apt install ffmpeg' or 'brew install ffmpeg')")
        return False
    return True


def get_subtitle_streams(video_path):
    """Inspect a video file with ffprobe and return a list of subtitle stream dicts."""
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "stream=index,codec_name,codec_type:stream_tags=language,title",
        "-of", "json",
        str(video_path),
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(res.stdout)
    except subprocess.CalledProcessError as e:
        log.error("ffprobe failed on %s: %s", video_path.name, e.stderr.strip())
        return []
    except json.JSONDecodeError:
        log.error("Failed to parse ffprobe output for %s", video_path.name)
        return []

    sub_streams = []
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "subtitle":
            tags = stream.get("tags") or {}
            lang = (tags.get("language") or "und").strip().lower()
            title = tags.get("title") or ""
            codec = stream.get("codec_name") or "unknown"
            sub_streams.append({
                "index": stream["index"],
                "codec": codec,
                "language": lang,
                "title": title,
            })
    return sub_streams


def build_output_name(video_path, stream, total_subs, out_format, strip_prefix=False):
    """Build a clean subtitle filename."""
    base_name = video_path.stem
    if strip_prefix:
        # Strip leading message ID prefix like '3_' or '123_'
        base_name = re.sub(r"^\d+_", "", base_name)

    lang = stream["language"]
    # If there are multiple subtitle tracks with the same language or undefined, include index
    if total_subs > 1 and (lang == "und" or stream.get("needs_index")):
        sub_name = f"{base_name}.{lang}.track{stream['index']}.{out_format}"
    else:
        sub_name = f"{base_name}.{lang}.{out_format}"

    return sub_name


def extract_subtitle(video_path, stream_index, output_path, overwrite=False):
    """Extract a single subtitle stream using ffmpeg."""
    if output_path.exists() and not overwrite:
        log.info("SKIP (exists) %s", output_path.name)
        return "skipped"

    cmd = [
        "ffmpeg",
        "-y" if overwrite else "-n",
        "-v", "error",
        "-i", str(video_path),
        "-map", f"0:{stream_index}",
        str(output_path),
    ]

    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True)
        log.info("EXTRACTED %s", output_path.name)
        return "extracted"
    except subprocess.CalledProcessError as e:
        log.error("ffmpeg failed on %s (stream %d): %s", video_path.name, stream_index, e.stderr.strip())
        return "error"


def process_video(video_path, output_dir, target_lang="all", out_format="srt",
                  overwrite=False, strip_prefix=False, dry_run=False):
    """Process a single video file, finding and extracting subtitles."""
    subs = get_subtitle_streams(video_path)
    if not subs:
        log.info("NO SUBTITLES %s", video_path.name)
        return {"extracted": 0, "skipped": 0, "no_subs": 1, "errors": 0}

    # Filter by language if specified
    if target_lang != "all":
        subs = [s for s in subs if s["language"] == target_lang]
        if not subs:
            log.info("NO MATCHING LANG (%s) in %s", target_lang, video_path.name)
            return {"extracted": 0, "skipped": 0, "no_subs": 1, "errors": 0}

    # Mark duplicates if any language appears multiple times
    lang_counts = {}
    for s in subs:
        lang_counts[s["language"]] = lang_counts.get(s["language"], 0) + 1
    for s in subs:
        if lang_counts[s["language"]] > 1:
            s["needs_index"] = True

    stats = {"extracted": 0, "skipped": 0, "no_subs": 0, "errors": 0}

    for stream in subs:
        sub_filename = build_output_name(video_path, stream, len(subs), out_format, strip_prefix)
        out_file = output_dir / sub_filename

        if dry_run:
            log.info("[DRY RUN] %s -> stream %d (%s, %s) -> %s",
                     video_path.name, stream["index"], stream["language"], stream["codec"], sub_filename)
            stats["extracted"] += 1
            continue

        res = extract_subtitle(video_path, stream["index"], out_file, overwrite=overwrite)
        if res == "extracted":
            stats["extracted"] += 1
        elif res == "skipped":
            stats["skipped"] += 1
        elif res == "error":
            stats["errors"] += 1

    return stats


def main():
    setup_logging()
    p = argparse.ArgumentParser(description="Extract embedded subtitles from video files")
    p.add_argument(
        "--input-dir", "-i",
        type=Path,
        default=DEFAULT_INPUT_DIR,
        help=f"directory containing video files (default: {DEFAULT_INPUT_DIR})",
    )
    p.add_argument(
        "--output-dir", "-o",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"directory to save extracted subtitles (default: {DEFAULT_OUTPUT_DIR})",
    )
    p.add_argument(
        "--file",
        type=Path,
        help="extract subtitles from a single video file instead of scanning directory",
    )
    p.add_argument(
        "--lang", "-l",
        default=DEFAULT_LANG,
        help=f"language filter code, e.g. 'eng', 'sin', or 'all' (default: {DEFAULT_LANG})",
    )
    p.add_argument(
        "--format", "-f",
        default=DEFAULT_FORMAT,
        help=f"subtitle output format, e.g. 'srt', 'vtt', 'ass' (default: {DEFAULT_FORMAT})",
    )
    p.add_argument(
        "--overwrite",
        action="store_true",
        help="overwrite existing extracted subtitle files",
    )
    p.add_argument(
        "--strip-prefix",
        action="store_true",
        help="strip leading numeric prefix from output filename (e.g. '3_Name' -> 'Name')",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="list detected subtitle streams without extracting",
    )

    args = p.parse_args()

    if not check_dependencies():
        sys.exit(1)

    target_lang = args.lang.strip().lower()
    out_format = args.format.strip().lower()
    out_dir = args.output_dir

    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    # Collect video files
    if args.file:
        if not args.file.exists():
            log.error("File not found: %s", args.file)
            sys.exit(1)
        video_files = [args.file]
    else:
        if not args.input_dir.exists():
            log.error("Input directory does not exist: %s", args.input_dir)
            sys.exit(1)
        video_files = sorted([
            f for f in args.input_dir.iterdir()
            if f.is_file() and f.suffix.lower() in VIDEO_EXTS
        ])

    if not video_files:
        log.warning("No video files found in %s", args.input_dir)
        sys.exit(0)

    log.info("Processing %d video file(s) (output: %s, lang: %s, format: %s)",
             len(video_files), out_dir, target_lang, out_format)

    totals = {"extracted": 0, "skipped": 0, "no_subs": 0, "errors": 0}
    for vid in video_files:
        stats = process_video(
            video_path=vid,
            output_dir=out_dir,
            target_lang=target_lang,
            out_format=out_format,
            overwrite=args.overwrite,
            strip_prefix=args.strip_prefix,
            dry_run=args.dry_run,
        )
        for k in totals:
            totals[k] += stats[k]

    if args.dry_run:
        log.info("Dry run complete: %d subtitle stream(s) found across %d video(s)",
                 totals["extracted"], len(video_files))
    else:
        log.info("Finished: %d extracted, %d skipped, %d no subtitles, %d error(s)",
                 totals["extracted"], totals["skipped"], totals["no_subs"], totals["errors"])

    sys.exit(1 if totals["errors"] > 0 else 0)


if __name__ == "__main__":
    main()
