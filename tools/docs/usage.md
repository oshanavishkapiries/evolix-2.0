# Usage and Commands

This document details all CLI flags, search options, regular expression filtering, and background execution modes.

---

## Command Line Interface Reference

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

### 3. Server-Side Keyword Search
Filter large channels directly on Telegram servers for messages containing a keyword or code:
```bash
python tg_downloader.py --search "720p"
```

### 4. Non-Video File Types
By default, the script targets video files (`.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, etc.). To download zip archives, PDFs, or software documents matching a regex:
```bash
python tg_downloader.py --regex "\.(zip|rar|7z)$" --all-files
```

### 5. Integrity Verification
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
