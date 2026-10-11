# Evolix 2.0 Media Tooling & Automation Suite

A collection of high-performance Python scripts for downloading media from Telegram channels, extracting subtitles, performing full CRUD management on Pixeldrain, curating TMDB metadata, and ingesting video streams into the [Evolix Platform](https://evolix-mu.vercel.app).

---

## Tool Overview

| Script | Purpose | Documentation |
|---|---|---|
| [`tg_downloader.py`](tg_downloader.py) | Resumable Telegram channel media downloader with regex, search, and message ID filters. | [Usage Guide](docs/usage.md) |
| [`upload_pixeldrain.py`](upload_pixeldrain.py) | Full CRUD CLI for Pixeldrain: upload, search, inspect, download, update, and delete files & albums. | [Pixeldrain Guide](docs/pixeldrain.md) |
| [`extract_subtitles.py`](extract_subtitles.py) | Extract embedded subtitles (`.srt`, `.vtt`, `.ass`) from video files using `ffmpeg`. | [Subtitles Guide](docs/subtitles.md) |
| [`select_clean_50.py`](select_clean_50.py) | Curates and validates feature films from raw channel dumps using TMDB and Evolix API. | [Pipeline Guide](docs/pipeline.md) |
| [`run_50_pipeline.py`](run_50_pipeline.py) | Fully automated end-to-end ingestion pipeline with transient local disk garbage collection. | [Pipeline Guide](docs/pipeline.md) |

---

## Quick Start

### 1. Environment Setup
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp env.example .env
# Edit .env with your Telegram, Pixeldrain, and Evolix admin credentials
```

### 2. Common Operations

#### Telegram Media Downloader
```bash
# Preview Season 1 episodes
python tg_downloader.py --regex "S01" --dry-run

# Download Season 1 episodes oldest-first
python tg_downloader.py --regex "S01" --reverse

# Download specific message IDs
python tg_downloader.py --ids 132,135,140
```

#### Pixeldrain CRUD Operations
```bash
# Search account files by name or regular expression
python upload_pixeldrain.py search "Batman"
python upload_pixeldrain.py search -r "S01E0[1-5]"

# Delete files by ID or pattern
python upload_pixeldrain.py delete <FILE_ID> -y
python upload_pixeldrain.py delete --regex "temp_.*\.mp4" -y

# Inspect file or album metadata
python upload_pixeldrain.py info <ID>

# List account files or albums
python upload_pixeldrain.py list-files --limit 10 --sort size
python upload_pixeldrain.py list-albums

# Check storage quota and bandwidth
python upload_pixeldrain.py user

# Upload a single file or directory
python upload_pixeldrain.py upload --file "movies/sample.mp4"
python upload_pixeldrain.py upload --list-title "Kids Animated Collection"
```

#### Subtitle Extractor
```bash
# Extract all embedded Sinhala and English subtitles
python extract_subtitles.py --lang all --strip-prefix
```

#### End-to-End Media Ingestion Pipeline
```bash
# 1. Curate and verify 50 new feature films against TMDB and Evolix
python select_clean_50.py

# 2. Run the automated ingestion pipeline
python run_50_pipeline.py
```

---

## Detailed Documentation

For in-depth architecture explanations, CLI flags, configuration parameters, and fault-tolerance details, consult the [`docs/`](docs/) directory:

- [Documentation Index](docs/index.md)
- [Setup and Configuration](docs/setup.md)
- [Usage & Commands Reference](docs/usage.md)
- [Architecture & Technical Reference](docs/architecture.md)
- [Pixeldrain CRUD & Upload Suite](docs/pixeldrain.md)
- [Subtitle Extraction](docs/subtitles.md)
- [Automated Ingestion Pipeline](docs/pipeline.md)
