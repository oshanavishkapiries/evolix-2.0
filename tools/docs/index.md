# Telegram Downloader Documentation

Welcome to the documentation for **tg-downloader**, a robust Telegram channel media and file downloader powered by [Telethon](https://github.com/LonamiWebs/Telethon) (MTProto user client).

---

## Key Highlights

- **Resumable Transfers**: Partial downloads are saved as `.part` files and resumed from the nearest 1 MB boundary without restarting from zero.
- **Search & Regex Filtering**: Server-side Telegram search (`--search`) and regular expression file name matching (`--regex`) for targeting exact seasons, formats, or episodes.
- **Dry-Run Mode**: Inspect matching items and file sizes with `--dry-run` before initiating any transfers.
- **Integrity Verification**: Automatic file size validation upon completion and SHA-256 fingerprinting saved into `manifest.json`. Re-verify with `--verify`.
- **Fault-Tolerant**: Transparently manages Telegram `FloodWaitError` rate limits, exponential backoff on network dropouts, and halts safely on disk exhaustion (`ENOSPC`).

---

## Documentation Sections

1. [Setup and Configuration](setup.md)
   - Telegram API credentials acquisition
   - Python virtual environment and dependencies
   - `.env` configuration file reference
2. [Usage and Commands](usage.md)
   - CLI options and flags reference
   - Search and regular expression examples
   - Background execution (systemd, nohup, tmux)
3. [Architecture & Technical Reference](architecture.md)
   - MTProto chunking mechanics
   - Atomic state persistence (`manifest.json`)
   - Error handling and retry strategy
4. [Subtitle Extraction](subtitles.md)
   - Extract embedded tracks into `.srt`, `.vtt`, `.ass`
   - Language filtering and clean naming options
5. [Pixeldrain Upload Utility](pixeldrain.md)
   - Upload videos and subtitles with retry mechanism
   - Automatic album/list generation and JSON reporting


