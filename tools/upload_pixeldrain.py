#!/usr/bin/env python3
"""Pixeldrain CLI & Utility: Complete CRUD operations (Upload, Search, Read, Update, Delete) for files and lists."""

import argparse
import json
import logging
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

import requests
from dotenv import load_dotenv

# Load from current directory or script directory
env_path = Path(__file__).resolve().parent / ".env"
if env_path.exists():
    load_dotenv(env_path)
else:
    load_dotenv()

API_KEY = os.getenv("PIXELDRAIN_API_KEY")
VIDEO_DIR = Path(os.getenv("SAVE_DIR", "downloads"))
SUBTITLE_DIR = Path(os.getenv("SUBTITLE_DIR", "subtitles"))
OUTPUT_JSON = Path("pixeldrain_uploads.json")
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "5"))

log = logging.getLogger("px_upload")


def setup_logging():
    log.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s")

    fh = RotatingFileHandler("pixeldrain_uploader.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)

    log.addHandler(fh)
    log.addHandler(sh)


def format_size(bytes_val):
    """Format bytes into human-readable representation."""
    if bytes_val is None:
        return "N/A"
    bytes_float = float(bytes_val)
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if abs(bytes_float) < 1024.0:
            return f"{bytes_float:3.1f} {unit}"
        bytes_float /= 1024.0
    return f"{bytes_float:.1f} PB"


def format_date(iso_str):
    """Format ISO date to short readable string."""
    if not iso_str:
        return "N/A"
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return iso_str[:16]


class ProgressReader:
    """Wraps an open file to report transfer progress during requests streaming."""
    def __init__(self, file_path, callback=None):
        self.file_path = file_path
        self.total_size = file_path.stat().st_size
        self._f = open(file_path, "rb")
        self.bytes_read = 0
        self.callback = callback

    def read(self, size=-1):
        chunk = self._f.read(size)
        if chunk:
            self.bytes_read += len(chunk)
            if self.callback:
                self.callback(self.bytes_read, self.total_size)
        return chunk

    def __len__(self):
        return self.total_size

    def close(self):
        self._f.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


# ==============================================================================
# Pixeldrain REST API Client Functions
# ==============================================================================

def get_user_info(api_key):
    """Fetch user account, subscription, storage quota, and bandwidth usage."""
    url = "https://pixeldrain.com/api/user"
    try:
        r = requests.get(url, auth=("", api_key), timeout=15)
        if r.status_code == 200:
            return r.json()
        log.error("Failed to fetch user info: HTTP %d %s", r.status_code, r.text)
    except requests.RequestException as e:
        log.error("Network error fetching user info: %s", e)
    return None


def get_user_files(api_key):
    """Fetch all files associated with the user account."""
    url = "https://pixeldrain.com/api/user/files"
    try:
        r = requests.get(url, auth=("", api_key), timeout=30)
        if r.status_code == 200:
            return r.json().get("files", [])
        log.error("Failed to fetch user files: HTTP %d %s", r.status_code, r.text)
    except requests.RequestException as e:
        log.error("Network error fetching user files: %s", e)
    return []


def get_user_lists(api_key):
    """Fetch all albums/lists associated with the user account."""
    url = "https://pixeldrain.com/api/user/lists"
    try:
        r = requests.get(url, auth=("", api_key), timeout=20)
        if r.status_code == 200:
            return r.json().get("lists", [])
        log.error("Failed to fetch user lists: HTTP %d %s", r.status_code, r.text)
    except requests.RequestException as e:
        log.error("Network error fetching user lists: %s", e)
    return []


def get_file_info(file_id, api_key):
    """Fetch detailed metadata for a single file."""
    url = f"https://pixeldrain.com/api/file/{file_id}/info"
    try:
        r = requests.get(url, auth=("", api_key), timeout=15)
        if r.status_code == 200:
            return r.json()
        elif r.status_code == 404:
            log.warning("File %s not found on Pixeldrain", file_id)
        else:
            log.error("Failed to get file info %s: HTTP %d", file_id, r.status_code)
    except requests.RequestException as e:
        log.error("Network error fetching file info: %s", e)
    return None


def get_list_info(list_id, api_key):
    """Fetch detailed metadata and item listing for a list/album."""
    url = f"https://pixeldrain.com/api/list/{list_id}"
    try:
        r = requests.get(url, auth=("", api_key), timeout=20)
        if r.status_code == 200:
            return r.json()
        elif r.status_code == 404:
            log.warning("List %s not found on Pixeldrain", list_id)
        else:
            log.error("Failed to get list info %s: HTTP %d", list_id, r.status_code)
    except requests.RequestException as e:
        log.error("Network error fetching list info: %s", e)
    return None


def verify_remote_file(file_id, api_key):
    """Check if file exists and is accessible on Pixeldrain."""
    info = get_file_info(file_id, api_key)
    return bool(info and info.get("success", False))


def delete_file(file_id, api_key):
    """Delete a single file by ID."""
    url = f"https://pixeldrain.com/api/file/{file_id}"
    try:
        r = requests.delete(url, auth=("", api_key), timeout=15)
        if r.status_code == 200:
            return True, "Deleted successfully"
        elif r.status_code == 404:
            return False, "File not found"
        elif r.status_code == 403:
            return False, "Forbidden: not owned by this account or unauthorized"
        else:
            return False, f"HTTP {r.status_code}: {r.text}"
    except requests.RequestException as e:
        return False, f"Network error: {e}"


def delete_list(list_id, api_key):
    """Delete a list/album by ID."""
    url = f"https://pixeldrain.com/api/list/{list_id}"
    try:
        r = requests.delete(url, auth=("", api_key), timeout=15)
        if r.status_code == 200:
            return True, "List deleted successfully"
        elif r.status_code == 404:
            return False, "List not found"
        else:
            return False, f"HTTP {r.status_code}: {r.text}"
    except requests.RequestException as e:
        return False, f"Network error: {e}"


def create_pixeldrain_list(title, file_ids, api_key):
    """Bundle uploaded file IDs into a Pixeldrain List (album view)."""
    url = "https://pixeldrain.com/api/list"
    payload = {
        "title": title,
        "anonymous": False,
        "files": [{"id": fid} for fid in file_ids],
    }
    try:
        r = requests.post(url, json=payload, auth=("", api_key), timeout=30)
        if r.status_code == 201:
            data = r.json()
            list_id = data.get("id")
            log.info("CREATED LIST: %s (ID: %s, URL: https://pixeldrain.com/l/%s)",
                     title, list_id, list_id)
            return list_id, f"https://pixeldrain.com/l/{list_id}"
        else:
            log.error("Failed to create list: HTTP %d %s", r.status_code, r.text)
    except requests.RequestException as e:
        log.error("Error creating list: %s", e)
    return None, None


def update_pixeldrain_list(list_id, title=None, add_ids=None, remove_ids=None, api_key=None):
    """Update list title, or add/remove files from a Pixeldrain List."""
    current = get_list_info(list_id, api_key)
    if not current:
        return False, f"List {list_id} not found"

    new_title = title if title else current.get("title", "Pixeldrain List")
    existing_files = [f["id"] for f in current.get("files", []) if isinstance(f, dict) and "id" in f]

    if remove_ids:
        rem_set = set(remove_ids)
        existing_files = [fid for fid in existing_files if fid not in rem_set]

    if add_ids:
        for fid in add_ids:
            if fid not in existing_files:
                existing_files.append(fid)

    url = f"https://pixeldrain.com/api/list/{list_id}"
    payload = {
        "title": new_title,
        "files": [{"id": fid} for fid in existing_files]
    }
    try:
        r = requests.put(url, json=payload, auth=("", api_key), timeout=30)
        if r.status_code == 200:
            return True, f"Updated list {list_id} ('{new_title}', {len(existing_files)} files)"
        return False, f"HTTP {r.status_code}: {r.text}"
    except requests.RequestException as e:
        return False, f"Network error updating list: {e}"


def upload_single_file(file_path, api_key, max_retries=MAX_RETRIES):
    """Upload a single file to Pixeldrain via PUT /api/file/{name} with retry and backoff."""
    file_name = file_path.name
    total_size = file_path.stat().st_size
    encoded_name = urllib.parse.quote(file_name)
    upload_url = f"https://pixeldrain.com/api/file/{encoded_name}"

    for attempt in range(1, max_retries + 1):
        last_pct = -1

        def on_progress(current, total):
            nonlocal last_pct
            pct = int(current * 100 / total) if total else 100
            if pct != last_pct and (pct % 5 == 0 or pct == 100):
                last_pct = pct
                cur_mb = current / (1024 * 1024)
                tot_mb = total / (1024 * 1024)
                print(f"\r  {pct:3d}%  {cur_mb:.1f}/{tot_mb:.1f} MB", end="", flush=True)

        try:
            log.info("UPLOADING %s (attempt %d/%d, %.1f MB)",
                     file_name, attempt, max_retries, total_size / (1024 * 1024))

            with ProgressReader(file_path, on_progress) as reader:
                resp = requests.put(
                    upload_url,
                    data=reader,
                    auth=("", api_key),
                    timeout=(30, 900),
                )

            print()

            if resp.status_code == 201:
                data = resp.json()
                file_id = data.get("id")
                log.info("SUCCESS %s -> ID: %s", file_name, file_id)
                return {
                    "name": file_name,
                    "size": total_size,
                    "id": file_id,
                    "url": f"https://pixeldrain.com/u/{file_id}",
                    "download_url": f"https://pixeldrain.com/api/file/{file_id}?download",
                    "uploaded_at": datetime.now(timezone.utc).isoformat(),
                }
            elif resp.status_code == 429:
                log.warning("Rate limited (HTTP 429). Backing off 15s...")
                time.sleep(15)
            elif resp.status_code >= 400:
                log.error("Upload error HTTP %d: %s", resp.status_code, resp.text)
                if resp.status_code == 401:
                    log.critical("Authentication failed. Invalid API key.")
                    return None
        except (requests.RequestException, IOError) as e:
            print()
            delay = min(2 ** attempt, 60)
            log.warning("Network/IO Error uploading %s: %s (retry in %ds)", file_name, e, delay)
            time.sleep(delay)

    log.error("FAILED %s after %d attempts", file_name, max_retries)
    return None


def download_file(file_id, output_path=None, output_dir=None, api_key=None):
    """Download a file by ID from Pixeldrain with real-time transfer progress."""
    info = get_file_info(file_id, api_key)
    remote_name = info.get("name", f"file_{file_id}") if info else f"file_{file_id}"
    total_size = info.get("size", 0) if info else 0

    if output_path:
        dest_path = Path(output_path)
    elif output_dir:
        dest_path = Path(output_dir) / remote_name
    else:
        dest_path = Path(remote_name)

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    part_path = dest_path.with_suffix(dest_path.suffix + ".part")

    download_url = f"https://pixeldrain.com/api/file/{file_id}?download"
    log.info("DOWNLOADING %s (%s) -> %s", remote_name, format_size(total_size), dest_path)

    try:
        r = requests.get(download_url, auth=("", api_key), stream=True, timeout=(30, 300))
        if not r.ok:
            log.error("Download failed HTTP %d: %s", r.status_code, r.text)
            return False

        received = 0
        last_pct = -1
        with open(part_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
                    received += len(chunk)
                    if total_size:
                        pct = int(received * 100 / total_size)
                        if pct != last_pct and (pct % 5 == 0 or pct == 100):
                            last_pct = pct
                            print(f"\r  {pct:3d}%  {format_size(received)} / {format_size(total_size)}", end="", flush=True)

        print()
        os.replace(part_path, dest_path)
        log.info("DOWNLOAD COMPLETE: %s (%s)", dest_path, format_size(received))
        return True
    except Exception as e:
        print()
        log.error("Download failed for %s: %s", file_id, e)
        if part_path.exists():
            part_path.unlink()
        return False


# ==============================================================================
# Manifest Management
# ==============================================================================

def load_manifest(path):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.warning("Existing %s was corrupted, creating a new manifest", path)
    return {
        "list_title": "Better Call Saul - Season 1",
        "list_id": None,
        "list_url": None,
        "total_files": 0,
        "total_size_bytes": 0,
        "files": [],
    }


def save_manifest(manifest, path):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


# ==============================================================================
# Action Handlers for CLI
# ==============================================================================

def handle_user(args, api_key):
    """Display user profile, storage, and transfer statistics."""
    user = get_user_info(api_key)
    if not user:
        return 1

    if getattr(args, "json", False):
        print(json.dumps(user, indent=2))
        return 0

    sub = user.get("subscription", {})
    storage_used = user.get("storage_space_used", 0)
    file_count = user.get("file_count", 0)
    bandwidth_used = user.get("monthly_transfer_used", 0)
    transfer_cap = sub.get("monthly_transfer_cap", 0)

    print("\n" + "=" * 60)
    print(" PIXELDRAIN ACCOUNT INFORMATION")
    print("=" * 60)
    print(f" Username:          {user.get('username')}")
    print(f" Email:             {user.get('email')}")
    print(f" Subscription:      {sub.get('name', 'Free')} (Type: {sub.get('type', 'standard')})")
    print(f" Storage Used:      {format_size(storage_used)}")
    print(f" Total Files:       {file_count}")
    print(f" Filesystem Space:  {format_size(user.get('filesystem_storage_used', 0))}")
    if transfer_cap:
        print(f" Monthly Bandwidth: {format_size(bandwidth_used)} / {format_size(transfer_cap)}")
    else:
        print(f" Monthly Bandwidth: {format_size(bandwidth_used)} (Uncapped/Standard)")
    print(f" Hotlinking:        {'Enabled' if user.get('hotlinking_enabled') else 'Disabled'}")
    print(f" Direct Download:   Supported")
    print("=" * 60 + "\n")
    return 0


def handle_list_files(args, api_key):
    """List files on the account."""
    files = get_user_files(api_key)
    if not files:
        print("No files found on account.")
        return 0

    sort_key = getattr(args, "sort", "date")
    if sort_key == "size":
        files.sort(key=lambda x: x.get("size", 0), reverse=True)
    elif sort_key == "name":
        files.sort(key=lambda x: x.get("name", "").lower())
    elif sort_key == "views":
        files.sort(key=lambda x: x.get("views", 0), reverse=True)
    elif sort_key == "downloads":
        files.sort(key=lambda x: x.get("downloads", 0), reverse=True)
    else:  # date
        files.sort(key=lambda x: x.get("date_upload", ""), reverse=True)

    limit = getattr(args, "limit", None)
    if limit and limit > 0:
        files = files[:limit]

    if getattr(args, "json", False):
        print(json.dumps(files, indent=2))
        return 0

    total_bytes = sum(f.get("size", 0) for f in files)
    print(f"\nShowing {len(files)} file(s) on Pixeldrain (Total: {format_size(total_bytes)}):\n")
    print(f"{'FILE ID':<10} {'SIZE':<10} {'DATE':<17} {'VIEWS':<7} {'DLS':<5} {'NAME'}")
    print("-" * 80)
    for f in files:
        fid = f.get("id", "")
        sz = format_size(f.get("size", 0))
        dt = format_date(f.get("date_upload", ""))
        views = str(f.get("views", 0))
        dls = str(f.get("downloads", 0))
        name = f.get("name", "")
        print(f"{fid:<10} {sz:<10} {dt:<17} {views:<7} {dls:<5} {name}")
    print("-" * 80 + "\n")
    return 0


def handle_search(args, api_key):
    """Search files by query string or regular expression."""
    files = get_user_files(api_key)
    query = args.query if hasattr(args, "query") and args.query else getattr(args, "search", "")
    use_regex = getattr(args, "regex", False)
    case_sensitive = getattr(args, "case_sensitive", False)

    if not query:
        log.error("Please specify a search query or regex pattern.")
        return 1

    matched = []
    if use_regex:
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            pat = re.compile(query, flags)
            matched = [f for f in files if pat.search(f.get("name", ""))]
        except re.error as e:
            log.error("Invalid regex pattern '%s': %s", query, e)
            return 1
    else:
        q_norm = query if case_sensitive else query.lower()
        matched = [
            f for f in files
            if (q_norm in f.get("name", "") if case_sensitive else q_norm in f.get("name", "").lower())
        ]

    if getattr(args, "json", False):
        print(json.dumps(matched, indent=2))
        return 0

    total_size = sum(f.get("size", 0) for f in matched)
    print(f"\nFound {len(matched)} matching file(s) for '{query}' (Total: {format_size(total_size)}):\n")
    if matched:
        print(f"{'FILE ID':<10} {'SIZE':<10} {'DATE':<17} {'DIRECT STREAM URL':<45} {'NAME'}")
        print("-" * 110)
        for f in matched:
            fid = f.get("id", "")
            sz = format_size(f.get("size", 0))
            dt = format_date(f.get("date_upload", ""))
            direct_url = f"https://pixeldrain.com/api/file/{fid}?download"
            name = f.get("name", "")
            print(f"{fid:<10} {sz:<10} {dt:<17} {direct_url:<45} {name}")
        print("-" * 110 + "\n")
    return 0


def handle_info(args, api_key):
    """Show detailed info for a file ID or list ID."""
    target_id = args.id if hasattr(args, "id") and args.id else getattr(args, "info", "")
    if not target_id:
        log.error("Please specify a file or list ID.")
        return 1

    # First try as file
    info = get_file_info(target_id, api_key)
    if info and info.get("success"):
        if getattr(args, "json", False):
            print(json.dumps(info, indent=2))
            return 0
        print("\n" + "=" * 60)
        print(f" FILE METADATA: {info.get('name')}")
        print("=" * 60)
        print(f" ID:               {info.get('id')}")
        print(f" Size:             {format_size(info.get('size'))} ({info.get('size')} bytes)")
        print(f" Upload Date:      {format_date(info.get('date_upload'))}")
        print(f" MIME Type:        {info.get('mime_type')}")
        print(f" SHA-256:          {info.get('hash_sha256')}")
        print(f" Views:            {info.get('views', 0)}")
        print(f" Downloads:        {info.get('downloads', 0)}")
        print(f" Bandwidth Used:   {format_size(info.get('bandwidth_used', 0))}")
        print(f" Can Edit/Delete:  {info.get('can_edit')}")
        print(f" Viewer URL:       https://pixeldrain.com/u/{info.get('id')}")
        print(f" Direct Download:  https://pixeldrain.com/api/file/{info.get('id')}?download")
        print("=" * 60 + "\n")
        return 0

    # Otherwise try as list
    list_info = get_list_info(target_id, api_key)
    if list_info and list_info.get("success"):
        if getattr(args, "json", False):
            print(json.dumps(list_info, indent=2))
            return 0
        files = list_info.get("files", [])
        print("\n" + "=" * 60)
        print(f" LIST/ALBUM METADATA: {list_info.get('title')}")
        print("=" * 60)
        print(f" ID:               {list_info.get('id')}")
        print(f" Date Created:     {format_date(list_info.get('date_created'))}")
        print(f" Total Files:      {list_info.get('file_count', len(files))}")
        print(f" Viewer URL:       https://pixeldrain.com/l/{list_info.get('id')}")
        print(" Files in Album:")
        for idx, f in enumerate(files, 1):
            fid = f.get("id")
            name = f.get("name") or f"File {fid}"
            print(f"   [{idx:2d}] {fid} - {name}")
        print("=" * 60 + "\n")
        return 0

    log.error("ID '%s' not found on Pixeldrain as file or list.", target_id)
    return 1


def handle_delete(args, api_key):
    """Delete files by ID, search query, or regex pattern."""
    target_ids = []
    if hasattr(args, "ids") and args.ids:
        if isinstance(args.ids, list):
            target_ids = args.ids
        else:
            target_ids = [x.strip() for x in args.ids.split(",") if x.strip()]
    elif getattr(args, "delete", None):
        target_ids = [x.strip() for x in args.delete.split(",") if x.strip()]

    # If deleting by search query or regex pattern
    del_search = getattr(args, "search", None)
    del_regex = getattr(args, "regex", None)

    if not target_ids and (del_search or del_regex):
        files = get_user_files(api_key)
        if del_regex:
            pat = re.compile(del_regex, re.IGNORECASE)
            matched = [f for f in files if pat.search(f.get("name", ""))]
        else:
            matched = [f for f in files if del_search.lower() in f.get("name", "").lower()]

        if not matched:
            print("No matching files found to delete.")
            return 0

        print(f"\nFound {len(matched)} file(s) matching criteria to delete:")
        for m in matched:
            print(f"  - {m['id']} : {m['name']} ({format_size(m.get('size', 0))})")

        auto_yes = getattr(args, "yes", False)
        if not auto_yes:
            confirm = input(f"\nAre you SURE you want to delete these {len(matched)} file(s)? [y/N]: ").strip().lower()
            if confirm != "y":
                print("Aborted deletion.")
                return 0

        target_ids = [m["id"] for m in matched]

    if not target_ids:
        log.error("No file ID(s) or patterns specified for deletion. Use: python upload_pixeldrain.py delete <ID>")
        return 1

    success_count = 0
    fail_count = 0

    for fid in target_ids:
        # Check name if possible
        info = get_file_info(fid, api_key)
        name = info.get("name", fid) if info else fid

        ok, msg = delete_file(fid, api_key)
        if ok:
            log.info("DELETED %s (%s)", fid, name)
            success_count += 1
        else:
            log.error("FAILED to delete %s (%s): %s", fid, name, msg)
            fail_count += 1

    print(f"\nDeletion finished: {success_count} deleted, {fail_count} failed.\n")
    return 0 if fail_count == 0 else 1


def handle_list_albums(args, api_key):
    """List all albums/lists on account."""
    lists = get_user_lists(api_key)
    if not lists:
        print("No albums/lists found on account.")
        return 0

    if getattr(args, "json", False):
        print(json.dumps(lists, indent=2))
        return 0

    print(f"\nFound {len(lists)} album(s) on Pixeldrain:\n")
    print(f"{'LIST ID':<10} {'FILES':<7} {'DATE CREATED':<17} {'URL':<32} {'TITLE'}")
    print("-" * 85)
    for l in lists:
        lid = l.get("id", "")
        fc = str(l.get("file_count", 0))
        dt = format_date(l.get("date_created", ""))
        url = f"https://pixeldrain.com/l/{lid}"
        title = l.get("title", "")
        print(f"{lid:<10} {fc:<7} {dt:<17} {url:<32} {title}")
    print("-" * 85 + "\n")
    return 0


def handle_create_list(args, api_key):
    """Create a new album list."""
    title = args.title or "Pixeldrain List"
    if not args.ids:
        log.error("Please supply comma-separated file IDs with --ids")
        return 1
    ids = [x.strip() for x in args.ids.split(",") if x.strip()]
    lid, url = create_pixeldrain_list(title, ids, api_key)
    if lid:
        print(f"\nSuccessfully created list '{title}':\n  ID:  {lid}\n  URL: {url}\n")
        return 0
    return 1


def handle_update_list(args, api_key):
    """Update title or membership of an existing list."""
    lid = args.id
    title = args.title
    add_ids = [x.strip() for x in args.add_ids.split(",") if x.strip()] if args.add_ids else None
    rem_ids = [x.strip() for x in args.remove_ids.split(",") if x.strip()] if args.remove_ids else None

    ok, msg = update_pixeldrain_list(lid, title=title, add_ids=add_ids, remove_ids=rem_ids, api_key=api_key)
    if ok:
        print(f"Success: {msg}")
        return 0
    print(f"Error: {msg}")
    return 1


def handle_delete_list(args, api_key):
    """Delete an album/list."""
    lid = args.id
    ok, msg = delete_list(lid, api_key)
    if ok:
        log.info("DELETED list %s: %s", lid, msg)
        return 0
    log.error("FAILED to delete list %s: %s", lid, msg)
    return 1


def handle_download(args, api_key):
    """Download a file by ID."""
    fid = args.id
    out_path = getattr(args, "output", None)
    out_dir = getattr(args, "output_dir", None)
    ok = download_file(fid, output_path=out_path, output_dir=out_dir, api_key=api_key)
    return 0 if ok else 1


def handle_upload(args, api_key):
    """Perform file uploads (single file or batch directory scanning)."""
    # 1. Single file upload
    if getattr(args, "file", None):
        fpath = Path(args.file)
        if not fpath.exists() or not fpath.is_file():
            log.error("File not found: %s", fpath)
            return 1
        res = upload_single_file(fpath, api_key)
        if res:
            print(f"\nUploaded: {res['name']}\n  ID: {res['id']}\n  URL: {res['url']}\n  Direct: {res['download_url']}\n")
            return 0
        return 1

    # 2. Batch upload
    video_dir = getattr(args, "video_dir", VIDEO_DIR)
    subtitle_dir = getattr(args, "subtitle_dir", SUBTITLE_DIR)
    output_json = getattr(args, "output_json", OUTPUT_JSON)
    list_title = getattr(args, "list_title", "Better Call Saul - Season 1")
    dry_run = getattr(args, "dry_run", False)
    no_subs = getattr(args, "no_subs", False)
    no_videos = getattr(args, "no_videos", False)
    regex_pattern = getattr(args, "regex", None)

    items_to_upload = []

    if not no_videos and video_dir and Path(video_dir).exists():
        video_exts = {".mkv", ".mp4", ".avi", ".mov", ".webm"}
        videos = sorted([f for f in Path(video_dir).iterdir() if f.is_file() and f.suffix.lower() in video_exts])
        for v in videos:
            items_to_upload.append({"path": v, "type": "video"})

    if not no_subs and subtitle_dir and Path(subtitle_dir).exists():
        sub_exts = {".srt", ".vtt", ".ass"}
        subs = sorted([f for f in Path(subtitle_dir).iterdir() if f.is_file() and f.suffix.lower() in sub_exts])
        for s in subs:
            items_to_upload.append({"path": s, "type": "subtitle"})

    if regex_pattern:
        pat = re.compile(regex_pattern, re.IGNORECASE)
        items_to_upload = [item for item in items_to_upload if pat.search(item["path"].name)]

    if not items_to_upload:
        log.warning("No files matched pattern or found to upload in %s or %s", video_dir, subtitle_dir)
        return 0

    total_bytes = sum(item["path"].stat().st_size for item in items_to_upload)
    log.info("Found %d file(s) to process (Total size: %.2f GB)",
             len(items_to_upload), total_bytes / (1024 ** 3))

    if dry_run:
        for idx, item in enumerate(items_to_upload, 1):
            sz_mb = item["path"].stat().st_size / (1024 * 1024)
            log.info("[%2d/%2d] [%s] %.1f MB - %s",
                     idx, len(items_to_upload), item["type"].upper(), sz_mb, item["path"].name)
        log.info("Dry run complete: %d files ready for upload", len(items_to_upload))
        return 0

    # Load existing upload manifest
    manifest = load_manifest(output_json)
    existing_map = {f["name"]: f for f in manifest.get("files", [])}

    uploaded_ids = []
    failed_files = []

    for idx, item in enumerate(items_to_upload, 1):
        fpath = item["path"]
        fname = fpath.name
        fsize = fpath.stat().st_size

        log.info("[%d/%d] Processing %s (%s)", idx, len(items_to_upload), fname, item["type"])

        # Check if already uploaded and valid
        if fname in existing_map:
            cached = existing_map[fname]
            if cached.get("size") == fsize and cached.get("id"):
                if verify_remote_file(cached["id"], api_key):
                    log.info("SKIP (already uploaded) %s -> %s", fname, cached["url"])
                    uploaded_ids.append(cached["id"])
                    continue
                else:
                    log.warning("Cached file ID %s invalid on remote, re-uploading...", cached["id"])

        info = upload_single_file(fpath, api_key)
        if info:
            info["type"] = item["type"]
            existing_map[fname] = info
            manifest["files"] = list(existing_map.values())
            manifest["total_files"] = len(manifest["files"])
            manifest["total_size_bytes"] = sum(f.get("size", 0) for f in manifest["files"])
            save_manifest(manifest, output_json)
            uploaded_ids.append(info["id"])
        else:
            failed_files.append(fname)

    # Create/Update Pixeldrain List if files were uploaded
    if uploaded_ids:
        log.info("Creating / Updating Pixeldrain album list with %d files...", len(uploaded_ids))
        list_id, list_url = create_pixeldrain_list(list_title, uploaded_ids, api_key)
        if list_id:
            manifest["list_id"] = list_id
            manifest["list_url"] = list_url
            manifest["list_title"] = list_title
            save_manifest(manifest, output_json)

    log.info("=" * 60)
    log.info("Upload process finished!")
    log.info("Total Uploaded Files: %d", len(manifest.get("files", [])))
    if manifest.get("list_url"):
        log.info("Folder/List URL: %s", manifest["list_url"])
    log.info("Manifest saved to: %s", output_json)
    if failed_files:
        log.error("Failed files: %s", failed_files)
        return 1

    return 0


# ==============================================================================
# Argument Parsing and Main Entrypoint
# ==============================================================================

def build_parser():
    p = argparse.ArgumentParser(
        prog="upload_pixeldrain.py",
        description="Pixeldrain Full CRUD Suite (Upload, Search, List, Inspect, Download, Delete)",
    )
    p.add_argument("--api-key", help="Pixeldrain API key (default: from .env)")

    # Fallback / Global flags for quick execution
    p.add_argument("--search", help="quick search user files by query")
    p.add_argument("--delete", help="quick delete file ID (comma-separated for multiple)")
    p.add_argument("--info", help="quick view metadata for a file or list ID")
    p.add_argument("--user-info", action="store_true", help="show user profile and storage stats")
    p.add_argument("--list-remote", action="store_true", help="list files on Pixeldrain account")
    p.add_argument("--list-albums", action="store_true", help="list albums on Pixeldrain account")
    p.add_argument("--yes", "-y", action="store_true", help="auto-confirm deletion prompts")
    p.add_argument("--json", action="store_true", help="output responses in JSON format")

    # Legacy upload flags at root level for seamless backward compatibility
    p.add_argument("--file", help="upload a single specific file")
    p.add_argument("--video-dir", type=Path, default=VIDEO_DIR, help="directory containing video files")
    p.add_argument("--subtitle-dir", type=Path, default=SUBTITLE_DIR, help="directory containing subtitle files")
    p.add_argument("--output-json", type=Path, default=OUTPUT_JSON, help="file to save upload links")
    p.add_argument("--list-title", default="Better Call Saul - Season 1", help="title for the Pixeldrain album/list")
    p.add_argument("--regex", "-r", help="regex pattern to filter files to upload or search")
    p.add_argument("--case-sensitive", action="store_true", help="case-sensitive search matching")
    p.add_argument("--dry-run", action="store_true", help="list files to be uploaded without uploading")
    p.add_argument("--no-subs", action="store_true", help="skip uploading subtitle files")
    p.add_argument("--no-videos", action="store_true", help="skip uploading video files")

    # Subcommands
    sub = p.add_subparsers(dest="command", help="available commands")

    # upload subcommand
    sub_up = sub.add_parser("upload", help="upload local files or directory to Pixeldrain")
    sub_up.add_argument("--file", help="upload a single specific file")
    sub_up.add_argument("--video-dir", type=Path, default=VIDEO_DIR)
    sub_up.add_argument("--subtitle-dir", type=Path, default=SUBTITLE_DIR)
    sub_up.add_argument("--output-json", type=Path, default=OUTPUT_JSON)
    sub_up.add_argument("--list-title", default="Better Call Saul - Season 1")
    sub_up.add_argument("--regex", "-r", help="regex pattern to filter files to upload")
    sub_up.add_argument("--dry-run", action="store_true")
    sub_up.add_argument("--no-subs", action="store_true")
    sub_up.add_argument("--no-videos", action="store_true")

    # search subcommand
    sub_search = sub.add_parser("search", help="search files on Pixeldrain account by name or regex")
    sub_search.add_argument("query", nargs="?", default="", help="query string or regex pattern")
    sub_search.add_argument("--regex", "-r", action="store_true", help="treat query as regular expression")
    sub_search.add_argument("--case-sensitive", action="store_true", help="case-sensitive search")
    sub_search.add_argument("--json", action="store_true", help="output JSON")

    # list-files / ls subcommand
    sub_ls = sub.add_parser("list-files", aliases=["ls"], help="list all files on Pixeldrain account")
    sub_ls.add_argument("--limit", type=int, help="max rows to display")
    sub_ls.add_argument("--sort", choices=["date", "size", "name", "views", "downloads"], default="date")
    sub_ls.add_argument("--json", action="store_true", help="output JSON")

    # list-albums subcommand
    sub_la = sub.add_parser("list-albums", help="list all albums/lists on Pixeldrain account")
    sub_la.add_argument("--json", action="store_true", help="output JSON")

    # info subcommand
    sub_info = sub.add_parser("info", help="get detailed metadata for a file or list ID")
    sub_info.add_argument("id", help="file ID or list ID")
    sub_info.add_argument("--json", action="store_true", help="output JSON")

    # delete subcommand
    sub_del = sub.add_parser("delete", aliases=["rm"], help="delete one or more files by ID or pattern")
    sub_del.add_argument("ids", nargs="*", help="file IDs to delete")
    sub_del.add_argument("--search", help="delete all files matching this query string")
    sub_del.add_argument("--regex", "-r", help="delete all files matching this regex pattern")
    sub_del.add_argument("--yes", "-y", action="store_true", help="skip confirmation prompt")

    # download subcommand
    sub_dl = sub.add_parser("download", help="download a file by ID")
    sub_dl.add_argument("id", help="file ID to download")
    sub_dl.add_argument("--output", "-o", help="output destination filename")
    sub_dl.add_argument("--output-dir", help="output destination folder")

    # user subcommand
    sub_user = sub.add_parser("user", help="show user account info, storage quota, and bandwidth")
    sub_user.add_argument("--json", action="store_true", help="output JSON")

    # create-list subcommand
    sub_cl = sub.add_parser("create-list", help="create a new list/album from file IDs")
    sub_cl.add_argument("--title", required=True, help="title of the list")
    sub_cl.add_argument("--ids", required=True, help="comma-separated file IDs")

    # update-list subcommand
    sub_ul = sub.add_parser("update-list", help="update an existing list/album")
    sub_ul.add_argument("id", help="list ID to update")
    sub_ul.add_argument("--title", help="new title for the list")
    sub_ul.add_argument("--add-ids", help="comma-separated file IDs to add")
    sub_ul.add_argument("--remove-ids", help="comma-separated file IDs to remove")

    # delete-list subcommand
    sub_dl_list = sub.add_parser("delete-list", help="delete a list/album by ID")
    sub_dl_list.add_argument("id", help="list ID to delete")

    return p


def main():
    setup_logging()
    parser = build_parser()
    args = parser.parse_args()

    api_key = args.api_key or API_KEY
    if not api_key:
        log.error("PIXELDRAIN_API_KEY is not set in .env or via --api-key")
        sys.exit(1)

    cmd = args.command

    # Dispatch subcommand or fallback flag
    if cmd == "user" or args.user_info:
        sys.exit(handle_user(args, api_key))
    elif cmd in ("list-files", "ls") or args.list_remote:
        sys.exit(handle_list_files(args, api_key))
    elif cmd == "list-albums" or args.list_albums:
        sys.exit(handle_list_albums(args, api_key))
    elif cmd == "search" or (args.search and not cmd):
        sys.exit(handle_search(args, api_key))
    elif cmd == "info" or (args.info and not cmd):
        sys.exit(handle_info(args, api_key))
    elif cmd in ("delete", "rm") or (args.delete and not cmd):
        sys.exit(handle_delete(args, api_key))
    elif cmd == "download":
        sys.exit(handle_download(args, api_key))
    elif cmd == "create-list":
        sys.exit(handle_create_list(args, api_key))
    elif cmd == "update-list":
        sys.exit(handle_update_list(args, api_key))
    elif cmd == "delete-list":
        sys.exit(handle_delete_list(args, api_key))
    else:
        # Default action is upload (either subcommand 'upload' or default execution)
        sys.exit(handle_upload(args, api_key))


if __name__ == "__main__":
    main()
