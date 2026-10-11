# Pixeldrain CRUD & Upload Suite (`upload_pixeldrain.py`)

The Pixeldrain utility provides a full **CRUD (Create, Read, Update, Delete)** command-line interface for managing files, albums/lists, downloads, and account storage on [Pixeldrain](https://pixeldrain.com).

It can be run via explicit subcommands (`upload`, `search`, `delete`, `info`, `list-files`, `list-albums`, `download`, `user`, etc.) or using convenient root-level flags for full backward compatibility.

---

## 1. Configuration (`.env`)

Add your Pixeldrain API key to `.env`:

```env
PIXELDRAIN_API_KEY=your_pixeldrain_api_key_here
SAVE_DIR=downloads
SUBTITLE_DIR=subtitles
MAX_RETRIES=5
```

---

## 2. Command Overview

| Command | Action | Description |
|---|---|---|
| `search <QUERY>` | **Read / Search** | Search account files by keyword or regex pattern (`-r`). |
| `delete <IDS...>` | **Delete** | Delete one or more files by ID, search query, or regex. |
| `list-files` (or `ls`) | **Read** | List all files on account with size, date, views, and downloads. |
| `list-albums` | **Read** | List all albums/lists on account. |
| `info <ID>` | **Read** | Display detailed metadata for a file ID or album list ID. |
| `download <ID>` | **Read** | Download a remote file to local disk with a progress indicator. |
| `user` | **Read** | Display account information, Pro status, storage usage, and bandwidth cap. |
| `upload` | **Create** | Upload a single file (`--file`) or batch scan directories (`--video-dir`). |
| `create-list` | **Create** | Bundle file IDs into a new Pixeldrain album list. |
| `update-list <ID>` | **Update** | Update album title or add/remove file IDs. |
| `delete-list <ID>` | **Delete** | Delete an album list by ID. |

---

## 3. CRUD Operations Reference

### C — CREATE: Upload Files & Create Albums

#### Upload a Single File
```bash
python upload_pixeldrain.py upload --file "movies/sample.mp4"
```
Or with root flag:
```bash
python upload_pixeldrain.py --file "movies/sample.mp4"
```

#### Batch Directory Upload
Upload all videos and subtitles from default directories:
```bash
python upload_pixeldrain.py upload
```
Filter files using a regular expression:
```bash
python upload_pixeldrain.py upload --regex "S01E0[1-5]"
```

#### Create a New Album List
```bash
python upload_pixeldrain.py create-list \
  --title "Kids Animated Movies (Sinhala Dubbed)" \
  --ids "hpTeEc3j,xVQ5iNoC,JmTbP15C"
```

---

### R — READ & SEARCH: Search, List, Inspect & Download

#### Search Files by Name / Keyword
```bash
python upload_pixeldrain.py search "Batman"
```
Output:
```text
Found 1 matching file(s) for 'Batman' (Total: 1.4 GB):

FILE ID    SIZE       DATE              DIRECT STREAM URL                             NAME
--------------------------------------------------------------------------------------------------------------
hpTeEc3j   1.4 GB     2026-10-11 03:03  https://pixeldrain.com/api/file/hpTeEc3j?download Batman - Mask of the Phantasm (1993) [1080p BluRay].mkv
--------------------------------------------------------------------------------------------------------------
```

#### Search Files Using Regular Expressions
```bash
python upload_pixeldrain.py search -r "S01E0[1-3].*mkv"
```

#### List Account Files
```bash
# List all files sorted by upload date
python upload_pixeldrain.py list-files

# List 10 largest files
python upload_pixeldrain.py list-files --limit 10 --sort size

# List sorted by downloads
python upload_pixeldrain.py list-files --sort downloads
```

#### Inspect File or Album Metadata (`info`)
Inspect detailed file properties (SHA-256, mime type, size, views, direct stream URL):
```bash
python upload_pixeldrain.py info hpTeEc3j
```

Inspect album details and list members:
```bash
python upload_pixeldrain.py info MmBydsuB
```

#### Download a Remote File
```bash
# Download to current directory using remote filename
python upload_pixeldrain.py download hpTeEc3j

# Download with a custom destination filename
python upload_pixeldrain.py download hpTeEc3j --output "downloads/batman.mkv"
```

#### Check User Profile & Storage Quota
```bash
python upload_pixeldrain.py user
```
Output:
```text
============================================================
 PIXELDRAIN ACCOUNT INFORMATION
============================================================
 Username:          oshanavishka
 Email:             oshanavishka06@gmail.com
 Subscription:      Pro (Type: patreon)
 Storage Used:      67.0 GB
 Total Files:       80
 Filesystem Space:  0.0 B
 Monthly Bandwidth: 2.1 GB / 3.6 TB
 Hotlinking:        Enabled
 Direct Download:   Supported
============================================================
```

---

### U — UPDATE: Update Albums & Re-upload Files

#### Update Album Title and Manage Members
Add new file IDs to an existing list:
```bash
python upload_pixeldrain.py update-list MmBydsuB --add-ids "DHkBZph2,AogKyZ8G"
```

Remove file IDs from an existing list:
```bash
python upload_pixeldrain.py update-list MmBydsuB --remove-ids "DHkBZph2"
```

Change list title:
```bash
python upload_pixeldrain.py update-list MmBydsuB --title "Kids Animated Classics"
```

---

### D — DELETE: Remove Files & Albums

#### Delete by File ID(s)
Delete a single file:
```bash
python upload_pixeldrain.py delete hpTeEc3j -y
```

Delete multiple specific files:
```bash
python upload_pixeldrain.py delete hpTeEc3j xVQ5iNoC JmTbP15C -y
```

#### Delete Files Matching Search Query
Finds all files matching a query, displays matches, and asks for confirmation:
```bash
python upload_pixeldrain.py delete --search "test_movie"
```
Or skip the confirmation prompt with `--yes` / `-y`:
```bash
python upload_pixeldrain.py delete --search "test_movie" --yes
```

#### Delete Files Matching Regular Expression
```bash
python upload_pixeldrain.py delete --regex "temp_.*\.mp4" -y
```

#### Delete an Album List
Delete an album (does not delete the files contained in the album):
```bash
python upload_pixeldrain.py delete-list MmBydsuB
```

---

## 4. Automation & Scripting Features

### JSON Output (`--json`)
All read commands (`search`, `list-files`, `list-albums`, `info`, `user`) support `--json` for scripting and integration with `jq` or external pipelines:
```bash
python upload_pixeldrain.py search "Saul" --json | jq '.[].id'
```

### Direct Streaming Integration for Evolix Platform
Direct streaming URLs generated by Pixeldrain follow the format:
```text
https://pixeldrain.com/api/file/{id}?download
```
These endpoints provide:
- `Accept-Ranges: bytes` — enables HTML5 media players (e.g. Vidstack in Evolix) to seek through multi-gigabyte video files.
- `Access-Control-Allow-Origin: *` — permits cross-origin web player streaming without CORS errors.
- Authentication: Basic auth (`auth=("", PIXELDRAIN_API_KEY)`) for private account assets or direct hotlinks when enabled.
