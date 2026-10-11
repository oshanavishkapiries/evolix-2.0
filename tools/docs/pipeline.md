# Automated Ingestion Pipeline (`run_50_pipeline.py` & `select_clean_50.py`)

The Evolix Media Ingestion Pipeline automates end-to-end catalog population: discovering raw media files in Telegram channels, verifying and matching metadata with The Movie Database (TMDB), streaming media to Pixeldrain, registering movie assets on the Evolix platform, and maintaining a minimal local disk footprint via transient storage management.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Discovery & Curation [Stage 1: Curation & Verification]
        TG_Dump[Telegram Channel Messages] --> FilterScript[select_clean_50.py]
        FilterScript --> TitleClean[Regex Sanitizer & Noise Remover]
        TitleClean --> TMDB_Search[Evolix TMDB Search Proxy]
        TMDB_Search --> DedupCheck{Already in Evolix DB?}
        DedupCheck -- Yes --> SkipDup[Skip Duplicate]
        DedupCheck -- No --> MoviePrefill[Verify Runtime >= 50m & Poster]
        MoviePrefill --> TargetList[verified_50_movies.json]
    end

    subgraph Pipeline Execution [Stage 2: End-to-End Pipeline]
        TargetList --> Runner[run_50_pipeline.py]
        Runner --> ProgressCheck{Already Processed in Progress JSON?}
        ProgressCheck -- Yes --> SkipProcessed[Skip]
        ProgressCheck -- No --> TG_Download[Stream Download via Telethon]
        TG_Download --> PxUpload[Stream Upload to Pixeldrain]
        PxUpload --> EvolixPost[Create Movie via /api/admin/movies]
        EvolixPost --> SourcePost[Attach Source via /api/admin/sources]
        SourcePost --> DiskCleanup[Delete Local File (target_path.unlink)]
        DiskCleanup --> SaveProg[Update pipeline_50_progress.json]
    end
```

---

## 1. Candidate Curation (`select_clean_50.py`)

Telegram movie channels typically feature noisy filenames with channel tags, watermarks, language descriptions, and encoding specs. Furthermore, channels frequently mix TV episodes, short clips, and movies.

`select_clean_50.py` performs automated cleaning and validation against the live Evolix backend:

### Key Functions & Logic

1. **Live Platform Deduplication**:
   - Queries `GET /api/admin/movies?pageSize=100` using admin credentials.
   - Builds sets of existing `tmdbId`s and lowercase movie titles to prevent creating duplicate entries.
2. **Title Sanitization (`clean_title`)**:
   - Removes file extensions (`.mp4`, `.mkv`, etc.).
   - Discards TV series, seasons, and episodes using pattern matching: `\b(ep|episode|season|s\d{1,2}|e\d{1,2}|pt|part|vol|chapter)\b`.
   - Extracts resolution (`1080p`, `720p`, `480p`) and release year (`1900-2029`).
   - Strips Telegram channel handles (`@sinhala...`), URLs, brackets, encoding tags (`bluray`, `web-dl`, `hevc`, `x264`), and non-ASCII noise.
3. **TMDB Matching**:
   - Calls Evolix's TMDB search proxy: `GET /api/admin/tmdb/search?type=movie&query={cleaned_title}`.
   - Matches by release year if present; otherwise applies fuzzy string matching on the title.
4. **Feature Film Validation**:
   - Fetches full movie prefill via `GET /api/admin/tmdb/movie/{tmdbId}`.
   - Ensures runtime is at least **50 minutes** (`runtimeMinutes >= 50`) to filter out shorts, trailers, and clips.
   - Enforces that a valid poster image exists (`posterPath` is not empty).
5. **Output**:
   - Writes the curated list to `verified_50_movies.json` containing TMDB metadata, normalized filenames, Telegram message IDs, and prefill payloads ready for direct API submission.

### Running Curation

```bash
python select_clean_50.py
```

Output:
```text
Existing movies: 15
[1] Valid Film: The Wild Robot (2024) | 102 min | TMDB 1184918 | Msg: 132
[2] Valid Film: Inside Out 2 (2024) | 96 min | TMDB 1022789 | Msg: 135
...
Total verified feature films found: 50
```

---

## 2. End-to-End Pipeline Execution (`run_50_pipeline.py`)

`run_50_pipeline.py` executes the entire ingestion lifecycle sequentially for each movie in `verified_50_movies.json`.

### Pipeline Stages

| Step | Operation | Description |
|---|---|---|
| **1. Download** | `download_telegram_movie` | Downloads media from Telegram channel using Telethon MTProto chunk streaming (`1 MB` chunks). Auto-recovers from `FileReferenceExpiredError`. |
| **2. Cloud Upload** | `upload_to_pixeldrain` | Streams the local file directly to Pixeldrain (`PUT /api/file/{name}`) with real-time percentage logging. |
| **3. Catalog Registration** | `evolix.create_movie` | Posts the prefilled TMDB movie object to `POST /api/admin/movies` with `isPublished=True`. |
| **4. Source Binding** | `evolix.attach_source` | Attaches the Pixeldrain direct download URL to `POST /api/admin/sources` as a `direct` stream with the detected quality tag (e.g. `720p`). |
| **5. Storage Cleanup** | Local Unlink | Immediately removes the completed local file via `target_path.unlink()`, freeing disk space before processing the next item. |
| **6. State Persistence** | `save_progress` | Appends completed movie record to `pipeline_50_progress.json`. |

---

## 3. Transient Storage & Zero-Disk Exhaustion

Processing 50 high-definition movies requires between 40 GB and 100 GB of temporary storage. Most cloud VPS environments have limited storage space.

The pipeline utilizes a **transient single-file buffer**:
1. At any given time, only **one** movie file exists on the local filesystem.
2. Once uploaded to Pixeldrain and linked to Evolix, the local file is unlinked (`os.unlink`).
3. Total disk usage never exceeds the size of the single largest movie being transferred (typically ~1–2 GB).

---

## 4. Fault Tolerance & Recovery Mechanisms

### File Reference Expiration (`FileReferenceExpiredError`)
Telegram file references are short-lived tokens valid for approximately 2 hours. When downloading multi-gigabyte queues, older message references expire.
- **Handling**: Catches `FileReferenceExpiredError` and invokes `client.get_messages(entity, ids=msg_id)` to renew the file reference in-flight. Resumes download from the exact last 1 MB boundary without restarting.

### Rate Limiting (`FloodWaitError` & HTTP 429)
- **Telegram**: Caught automatically; sleeps for `e.seconds + 1` before resuming.
- **Pixeldrain**: On HTTP 429, sleeps for 15 seconds before retrying with exponential backoff.

### Authentication Expiration
- `EvolixClient` detects HTTP 401 Unauthorized responses during ingestion, automatically re-authenticates via `POST /api/auth/login`, and retries the request seamlessly.

### Resumability via `pipeline_50_progress.json`
Every successfully ingested movie is recorded in `pipeline_50_progress.json`:
```json
{
  "completed": [
    {
      "tmdb_id": 1184918,
      "title": "The Wild Robot",
      "year": 2024,
      "movie_id": "clyx987...",
      "source_id": "clyx988...",
      "pixeldrain_id": "vL89Qwe",
      "pixeldrain_url": "https://pixeldrain.com/u/vL89Qwe",
      "quality": "720p",
      "completed_at": "2026-10-11T09:12:30Z"
    }
  ]
}
```
If the process is stopped or interrupted, restarting `python run_50_pipeline.py` skips all previously recorded movies and continues from the next incomplete item.

---

## 5. Execution & Monitoring

### Starting the Pipeline
```bash
python run_50_pipeline.py
```

### Running in Background
```bash
nohup python run_50_pipeline.py > pipeline_50.log 2>&1 &
```

### Monitoring Progress
```bash
# View live pipeline logs
tail -f pipeline_50.log

# Check number of completed movies
jq '.completed | length' pipeline_50_progress.json

# View latest completed movie details
jq '.completed[-1]' pipeline_50_progress.json
```
