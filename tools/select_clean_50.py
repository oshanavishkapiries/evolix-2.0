import json
import os
import re
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

BASE = "https://evolix-mu.vercel.app"
s = requests.Session()
s.post(f"{BASE}/api/auth/login", json={"email": os.getenv("ADMIN_EMAIL"), "password": os.getenv("ADMIN_PASS")})

ex_data = s.get(f"{BASE}/api/admin/movies", params={"pageSize": 100}).json()
EXISTING_TMDB = {m["tmdbId"] for m in ex_data.get("movies", [])}
EXISTING_TITLES = {m["title"].lower() for m in ex_data.get("movies", [])}
print(f"Existing movies: {len(EXISTING_TMDB)}")

with open("/home/ubuntu/PROJECTS/evolix-2.0/tools/raw_channel_videos.json") as f:
    raw_videos = json.load(f)

def clean_title(filename, caption):
    combined = f"{filename} {caption}"
    raw = re.sub(r'\.(mp4|mkv|webm|avi|mov)$', '', filename, flags=re.IGNORECASE)
    
    # Exclude obvious TV episodes / series
    if re.search(r'\b(ep|episode|season|s\d{1,2}|e\d{1,2}|pt|part|vol|chapter)\b', combined, re.IGNORECASE):
        return None, None, None

    quality = "720p"
    if "1080p" in combined.lower():
        quality = "1080p"
    elif "480p" in combined.lower():
        quality = "480p"

    year_match = re.search(r'\b(19\d{2}|20[0-2]\d)\b', combined)
    year = int(year_match.group(1)) if year_match else None

    cleaned = re.sub(r'@\w+', '', raw)
    cleaned = re.sub(r'https?://\S+', '', cleaned)
    cleaned = re.sub(r'\[.*?\]|\(.*?\)', '', cleaned)
    cleaned = re.sub(r'\b(19\d{2}|20[0-2]\d)\b', '', cleaned)
    cleaned = re.sub(r'\b(1080p|720p|480p|360p|2160p|4k|bluray|web-?rip|web-?dl|hd|hdtv|x264|x265|hevc|aac|dvdrip|pupilvideo|sinhalafilmsgo|filmmania)\b', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\b(sinhala|dubbed|subbed|full|movie|film|tamil|hindi|hq)\b', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'[^\x00-\x7F]+', ' ', cleaned)
    cleaned = re.sub(r'[\._\+\-]', ' ', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned, year, quality

feature_films = {}

for item in raw_videos:
    q_str, year, quality = clean_title(item["file_name"], item["caption"])
    if not q_str or len(q_str) < 3:
        continue

    words = q_str.split()
    query = " ".join(words[:4]) if len(words) > 4 else q_str

    try:
        r = s.get(f"{BASE}/api/admin/tmdb/search", params={"type": "movie", "query": query}, timeout=10)
        if not r.ok:
            continue
        results = r.json().get("results", [])
    except Exception:
        continue

    if not results:
        continue

    matched = None
    if year:
        for res in results:
            if res.get("year") == year and res.get("posterPath"):
                matched = res
                break
    if not matched:
        for res in results[:3]:
            if not res.get("posterPath"):
                continue
            t1 = re.sub(r'[^a-z0-9]', '', query.lower())
            t2 = re.sub(r'[^a-z0-9]', '', res["title"].lower())
            if t1 and (t1 == t2 or t1 in t2 or t2 in t1):
                matched = res
                break

    if not matched:
        continue

    tmdb_id = matched["tmdbId"]
    if tmdb_id in EXISTING_TMDB or tmdb_id in feature_films:
        continue
    if matched["title"].lower() in EXISTING_TITLES:
        continue

    # Verify movie prefill has a real feature film runtime
    try:
        p_res = s.get(f"{BASE}/api/admin/tmdb/movie/{tmdb_id}", timeout=10)
        if not p_res.ok:
            continue
        movie_obj = p_res.json().get("movie", {})
        runtime = movie_obj.get("runtimeMinutes") or 0
        # Feature films should be at least 50 minutes
        if runtime < 50:
            continue
        if not movie_obj.get("posterPath"):
            continue
    except Exception:
        continue

    clean_title_str = re.sub(r'[\\/:*?"<>|]', '_', matched["title"])
    norm_filename = f"{clean_title_str} ({matched.get('year') or year or ''}) [{quality}].{item['ext'].strip('.')}"

    feature_films[tmdb_id] = {
        "msg_id": item["msg_id"],
        "file_name": norm_filename,
        "raw_name": item["file_name"],
        "size_mb": item["size_mb"],
        "tmdb_id": tmdb_id,
        "tmdb_title": matched["title"],
        "tmdb_year": matched.get("year"),
        "runtime": runtime,
        "quality": quality,
        "prefill": movie_obj
    }

    print(f"[{len(feature_films)}] Valid Film: {matched['title']} ({matched.get('year')}) | {runtime} min | TMDB {tmdb_id} | Msg: {item['msg_id']}")
    if len(feature_films) >= 50:
        break

print(f"\nTotal verified feature films found: {len(feature_films)}")
with open("/home/ubuntu/PROJECTS/evolix-2.0/tools/verified_50_movies.json", "w") as f:
    json.dump(list(feature_films.values()), f, indent=2)
