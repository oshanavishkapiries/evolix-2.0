"""Multi-engine behaviour against two stub engines (evo-engine/stub_engine.py) and an app started with both.

    # engines (separate databases), then the app:
    for n in 1 2; do (cd evo-engine && SQLITE_DB_PATH=/tmp/e$n.sqlite3 DOWNLOAD_DIR=/tmp/e$n/dl TEMP_DIR=/tmp/e$n/tmp \\
        STUB_EXTRACT_SECONDS=2 MAX_CONCURRENT_EXTRACTIONS=1 PYTHONPATH=. test/.venv/bin/uvicorn stub_engine:app --port 800$n &); done
    EVO_ENGINES='["http://127.0.0.1:8001","http://127.0.0.1:8002"]' pnpm dev
    E2E_ACCESS_TOKEN=$(...) test/.venv/bin/python tests/e2e/multi_engine.py   (see tests/e2e/multi_engine.sh)

Needs real TMDB access (title lookups). Creates catalog rows for the test titles (harmless, and reused).
"""
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
TOKEN = os.environ["E2E_ACCESS_TOKEN"]
SECRET = os.environ["EVO_SECRET_TOKEN"]
ENGINES = {"e1": "http://127.0.0.1:8001", "e2": "http://127.0.0.1:8002"}
results = []


def check(ok, msg):
    results.append(ok)
    print("PASS" if ok else "FAIL", msg)


def app(method, path, body=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Cookie": f"access_token={TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            return r.status, (data if raw else json.loads(data or b"{}"))
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            return e.code, json.loads(data or b"{}")
        except Exception:
            return e.code, {"raw": data[:200].decode(errors="replace")}


def engine(name, path):
    req = urllib.request.Request(ENGINES[name] + "/api/v1/media" + path, headers={"X-Evo-Secret": SECRET})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def tasks_on(name):
    return {t["task_id"]: t for t in engine(name, "/tasks?limit=200")}


def ingest(tmdb, quality="720p"):
    return app("POST", "/api/evo/ingest", {"tmdbId": tmdb, "mediaType": "movie", "quality": quality})


def parallel(fn, args):
    out = [None] * len(args)

    def run(i):
        out[i] = fn(*args[i])

    ts = [threading.Thread(target=run, args=(i,)) for i in range(len(args))]
    [t.start() for t in ts]
    [t.join() for t in ts]
    return out


def owner(task_id):
    on = [n for n in ENGINES if task_id in tasks_on(n)]
    return on


# 1. Distribution: four different titles at once spread over both engines (capacity 1 each, 2s per extraction).
titles = [862, 603, 550, 13]  # keep in sync with TITLES in multi_engine.sh
res = parallel(ingest, [(t,) for t in titles])
ok = [r for r in res if r[0] == 200]
check(len(ok) == len(titles), f"all {len(titles)} ingests accepted: {[r[0] for r in res]}")
ids = [r[1]["task_id"] for r in ok]
placed = {t: owner(t) for t in ids}
check(all(len(v) == 1 for v in placed.values()), "every task exists on exactly one engine")
per = {n: sum(1 for v in placed.values() if v == [n]) for n in ENGINES}
check(all(c >= 1 for c in per.values()), f"jobs were distributed over both engines: {per}")

# 2. Duplicates: 6 simultaneous identical requests -> one job (the app allows 12 ingests per user per 10 minutes).
dup = parallel(ingest, [(238,)] * 6)
dup_ids = {r[1].get("task_id") for r in dup if r[0] == 200}
check(len(dup_ids) == 1, f"6 identical concurrent requests share one task: {len(dup_ids)} id(s), statuses {sorted({r[0] for r in dup})}")
dup_on = owner(next(iter(dup_ids)))
check(len(dup_on) == 1, f"...which lives on exactly one engine: {dup_on}")
count = sum(1 for n in ENGINES for t in tasks_on(n).values() if t["tmdb_id"] == 238 and t["requested_quality"] == "720p")
check(count == 1, f"no copy of the duplicate job anywhere ({count})")

# 3. A second quality of the same title goes to the same engine (shares its extraction).
q2 = ingest(238, "1080p")
check(q2[0] == 200 and owner(q2[1]["task_id"]) == dup_on, "another quality of the same title lands on the same engine")

# 4. Routing: status, stream and admin task detail reach the owning engine only.
tid = ids[0]
home = placed[tid][0]
other = [n for n in ENGINES if n != home][0]
time.sleep(4)
code, st = app("GET", f"/api/evo/status/{tid}")
check(code == 200 and st.get("task_id") == tid, f"status for a task of engine {home} is served ({code})")
log_before = {n: open(f"{os.environ['E2E_LOG_DIR']}/{n}/log").read().count("/stream/") for n in ENGINES} if os.environ.get("E2E_LOG_DIR") else None
app("GET", f"/api/evo/stream/{tid}/master.m3u8", raw=True)
if log_before is not None:
    time.sleep(0.5)
    after = {n: open(f"{os.environ['E2E_LOG_DIR']}/{n}/log").read().count("/stream/") for n in ENGINES}
    check(after[home] > log_before[home] and after[other] == log_before[other], f"the stream request hit engine {home} only ({log_before} -> {after})")
code, detail = app("GET", f"/api/admin/evo/tasks/{tid}")
check(code == 200 and detail.get("task", {}).get("task_id") == tid, "admin task detail comes from the owning engine")

# 5. Completion webhook: finished jobs are registered, crediting the engine that produced them.
time.sleep(12)
db = json.loads(subprocess.check_output(["node", "tests/e2e/multi_engine_db.mjs", *map(str, titles)]))
check(len(db["sources"]) >= 1 and all(s["engine_id"] in ("127.0.0.1-8001", "127.0.0.1-8002") for s in db["sources"]), f"sources credit their engine: {db['sources'][:3]}")
check(db["tasks_recorded"] >= len(ids), f"task ownership recorded in the database ({db['tasks_recorded']})")

# 6. Sinhala translation is claimed, routed and registered the same way.
code, si = app("POST", "/api/evo/translate", {"tmdbId": 11, "mediaType": "movie"})
check(code == 200 and si.get("state") in ("running", "done"), f"Sinhala job started: {si.get('state')}")
final = si
for _ in range(30):
    if final.get("state") == "done":
        break
    time.sleep(1)
    _, final = app("GET", "/api/evo/translate?tmdbId=11&mediaType=movie")
check(final.get("state") == "done", f"Sinhala job finished through its engine: {final.get('state')} {final.get('message', '')}")
code, again = app("POST", "/api/evo/translate", {"tmdbId": 11, "mediaType": "movie"})
check(again.get("state") == "done", "asking again does not start another job")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
