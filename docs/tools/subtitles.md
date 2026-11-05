# Subtitle Extraction (`extract_subtitles.py`)

This utility script scans downloaded video files (MKV, MP4, AVI, WebM, etc.) and extracts their embedded subtitle tracks into standalone subtitle files (`.srt`, `.vtt`, `.ass`) using `ffmpeg` and `ffprobe`.

---

## 1. Requirements

- `ffmpeg` and `ffprobe` installed on your system:
  ```bash
  # Debian / Ubuntu
  sudo apt install ffmpeg

  # macOS
  brew install ffmpeg
  ```

---

## 2. Configuration (`.env`)

The script shares the project's root `.env` file and reads the following variables:

```env
# Shared directory where videos are stored
SAVE_DIR=downloads

# Subtitle Extraction settings
SUBTITLE_DIR=subtitles
SUBTITLE_LANG=all
SUBTITLE_FORMAT=srt
```

| Variable | Default | Description |
|---|---|---|
| `SAVE_DIR` | `downloads` | Default input folder containing downloaded videos. |
| `SUBTITLE_DIR` | `subtitles` | Default output directory for extracted subtitles. |
| `SUBTITLE_LANG` | `all` | Language code filter (e.g. `all`, `eng`, `sin`). |
| `SUBTITLE_FORMAT` | `srt` | Target subtitle extension (`srt`, `ass`, `vtt`). |

---

## 3. CLI Options Reference

```bash
python extract_subtitles.py [OPTIONS]
```

| Option | Flag | Description | Default |
|---|---|---|---|
| `--input-dir` | `-i` | Input directory containing videos | `downloads` |
| `--output-dir` | `-o` | Output directory for subtitle files | `subtitles` |
| `--file` | | Process a single specific video file | None |
| `--lang` | `-l` | Target subtitle language (e.g., `sin`, `eng`, `all`) | `all` |
| `--format` | `-f` | Subtitle format (`srt`, `vtt`, `ass`) | `srt` |
| `--strip-prefix` | | Strip leading numeric message IDs (e.g. `3_Name` -> `Name`) | `False` |
| `--overwrite` | | Overwrite existing subtitle files | `False` (skip existing) |
| `--dry-run` | | Scan and preview streams without extracting | `False` |

---

## 4. Usage Examples

### Extract All Subtitles in Download Directory
```bash
python extract_subtitles.py
```

### Preview Embedded Subtitle Streams (Dry Run)
```bash
python extract_subtitles.py --dry-run
```

### Filter by Specific Language
```bash
# Only extract English subtitles
python extract_subtitles.py --lang eng

# Only extract Sinhala subtitles
python extract_subtitles.py --lang sin
```

### Clean Subtitle Filenames (Strip Numeric Prefixes)
```bash
python extract_subtitles.py --strip-prefix
```
Outputs files like `Better.Call.Saul.S01E01.720p.BluRay.x265.10bit.sin.srt` instead of `3_Better.Call.Saul...`.

### Extract from a Single Video
```bash
python extract_subtitles.py --file "downloads/3_Better.Call.Saul.S01E01.720p.BluRay.x265.10bit.mkv"
```

### Force Overwrite Existing Subtitles
```bash
python extract_subtitles.py --overwrite
```
