# Usage and Commands

This document details all CLI flags, search options, regular expression filtering, message ID selection, and background execution modes for `tg_downloader.py`, along with cross-references to the rest of the media tooling suite.

---

## Telegram Downloader CLI Reference

```bash
python tg_downloader.py [OPTIONS]
```

### Options Table

| Option | Flag | Description | Default |
|---|---|---|---|
| `--channel` | | Override `CHANNEL` set in `.env` | From `.env` |
| `--save-dir` | | Override download directory | `downloads` |
| `--search` | `-s` | Query string for Telegram server-side message search | None |
| `--regex` | `-r` | Regular expression pattern matched against file names | None |
| `--case-sensitive` | | Make regex matching case-sensitive | `False` (case-insensitive) |
| `--ids` | | Comma-separated Telegram message IDs to download | None (all messages) |
| `--all-files` | | Download any media/document type, not just videos | `False` |
| `--dry-run` | | Preview matched files and sizes without downloading | `False` |
| `--limit` | | Maximum number of messages to evaluate | All messages |
| `--reverse` | | Traverse from oldest messages to newest | Newest first |
| `--verify` | | Verify downloaded files against `manifest.json` | `False` |

---

## Practical Examples

### 1. Download a Specific Season
Download all episodes belonging to Season 1 in chronological order:
```bash
python tg_downloader.py --regex "S01" --reverse
```

### 2. Preview Matches Before Downloading (Dry Run)
Inspect which files match a pattern without downloading any bytes:
```bash
python tg_downloader.py --regex "S01E(0[1-5])" --dry-run
```
Output:
```text
INFO    Channel: Better Call Saul
INFO    Regex filter: 'S01E(0[1-5])' (case_sensitive=False)
INFO    [MATCH] ID: 3 | 290 MB | 3_Better.Call.Saul.S01E01.720p.BluRay.x265.10bit.mkv
INFO    [MATCH] ID: 4 | 311 MB | 4_Better.Call.Saul.S01E02.720p.BluRay.x265.10bit.mkv
...
INFO    Dry run complete: 5 matching file(s) found
```

### 3. Target Specific Message IDs
Download specific known message IDs directly:
```bash
python tg_downloader.py --ids 132,135,140
```

### 4. Server-Side Keyword Search
Filter large channels directly on Telegram servers for messages containing a keyword or code:
```bash
python tg_downloader.py --search "720p"
```

### 5. Non-Video File Types
By default, the script targets video files (`.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, etc.). To download zip archives, PDFs, or software documents matching a regex:
```bash
python tg_downloader.py --regex "\.(zip|rar|7z)$" --all-files
```

### 6. Integrity Verification
Re-calculate SHA-256 hashes for all previously downloaded files and compare them against `manifest.json` to detect file corruption:
```bash
python tg_downloader.py --verify
```

---

## Running in the Background

For large batches on servers or virtual machines:

```bash
nohup python tg_downloader.py --regex "S01" --reverse > run.out 2>&1 &
```

Follow the logs in real time:
```bash
tail -f downloader.log
```

---

## Tool Suite Quick Reference

Beyond standalone Telegram downloading, the tooling suite includes specialized scripts for each stage of media operations:

| Tool | Script | Documentation |
|---|---|---|
| **Cloud Upload** | `upload_pixeldrain.py` | [Pixeldrain Guide](pixeldrain.md) |
| **Subtitle Extraction** | `extract_subtitles.py` | [Subtitles Guide](subtitles.md) |
| **Movie Curation** | `select_clean_50.py` | [Pipeline Guide](pipeline.md) |
| **End-to-End Pipeline** | `run_50_pipeline.py` | [Pipeline Guide](pipeline.md) |
