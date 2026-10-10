# Pixeldrain Upload Utility (`upload_pixeldrain.py`)

This script uploads downloaded videos and extracted subtitles to [Pixeldrain](https://pixeldrain.com) using its REST API, provides automated retry mechanisms, tracks upload state in a manifest, and bundles all uploaded files into a unified Pixeldrain album/list.

---

## 1. Configuration (`.env`)

Add your Pixeldrain API key to the project root `.env`:

```env
PIXELDRAIN_API_KEY=your_pixeldrain_api_key_here
```

---

## 2. CLI Options Reference

```bash
python upload_pixeldrain.py [OPTIONS]
```

| Option | Description | Default |
|---|---|---|
| `--api-key` | Pixeldrain API Key | From `PIXELDRAIN_API_KEY` in `.env` |
| `--video-dir` | Directory containing video files to upload | `downloads` |
| `--subtitle-dir` | Directory containing subtitle files to upload | `subtitles` |
| `--output-json` | Path to save the final JSON links report | `pixeldrain_uploads.json` |
| `--list-title` | Title for the created Pixeldrain album list | `Better Call Saul - Season 1` |
| `--dry-run` | Scan and preview files without uploading | `False` |
| `--no-subs` | Skip uploading subtitle files | `False` |
| `--no-videos` | Skip uploading video files | `False` |

---

## 3. Features & Resiliency

- **Direct Stream Upload**: Uses `PUT /api/file/{name}` with HTTP Basic Authentication.
- **Automatic Retry with Exponential Backoff**: Retries on network interruptions, timeouts, and rate limits (HTTP 429).
- **Persistent State & Resuming**: Progress is saved immediately to `pixeldrain_uploads.json`. If interrupted, running the script again verifies existing uploads and resumes remaining files.
- **Automatic Album/List Creation**: Bundles all files into a shareable list (`POST /api/list`) accessible via `https://pixeldrain.com/l/<list_id>`.

---

## 4. Usage Examples

```bash
# Preview files to be uploaded (Dry Run)
python upload_pixeldrain.py --dry-run

# Upload all videos and subtitles
python upload_pixeldrain.py

# Upload only videos (skip subtitles)
python upload_pixeldrain.py --no-subs

# Custom album title
python upload_pixeldrain.py --list-title "Better Call Saul - Season 1 (720p Bluray)"
```
