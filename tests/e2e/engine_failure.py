"""Engine failure, retry elsewhere, recovery and draining with two stub engines (starts and stops everything itself).

    E2E_ACCESS_TOKEN=... EVO_SECRET_TOKEN=... evo-engine/test/.venv/bin/python tests/e2e/engine_failure.py   (see engine_failure.sh)

Engines: A = 127.0.0.1:8001, B = 127.0.0.1:8002. Needs real TMDB access and the app's .env.
"""
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

BASE = "http://localhost:3000"
TOKEN = os.environ["E2E_ACCESS_TOKEN"]
SECRET = os.environ["EVO_SECRET_TOKEN"]
A, B = "127.0.0.1-8001", "127.0.0.1-8002"
PORTS = {A: 8001, B: 8002}
work = tempfile.mkdtemp(prefix="evo-failure-")
procs = {}
results = []


def check(ok, msg):
    results.append(ok)
    print("PASS" if ok else "FAIL", msg)


def start_engine(eid):
    n = PORTS[eid]
    os.makedirs(f"{work}/{n}/dl", exist_ok=True)
    os.makedirs(f"{work}/{n}/tmp", exist_ok=True)
    env = {**os.environ, "PYTHONPATH": ".", "SQLITE_DB_PATH": f"{work}/{n}/db.sqlite3", "DOWNLOAD_DIR": f"{work}/{n}/dl", "TEMP_DIR": f"{work}/{n}/tmp",
           "STUB_EXTRACT_SECONDS": "2", "MAX_CONCURRENT_EXTRACTIONS": "1", "MIN_FREE_DISK_GB": "1"}
    procs[eid] = subprocess.Popen(["test/.venv/bin/python", "-m", "uvicorn", "stub_engine:app", "--host", "127.0.0.1", "--port", str(n)], cwd="evo-engine", env=env,
                                  stdout=open(f"{work}/{n}.log", "a"), stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(40):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{n}/health", timeout=1)
            return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f"engine {n} did not start")


def stop_engine(eid):
    p = procs.pop(eid, None)
    if p:
        os.killpg(p.pid, signal.SIGKILL)
        p.wait()


def app(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={"Cookie": f"access_token={TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except Exception:
            return e.code, {}


def owners(ids):
    return json.loads(subprocess.check_output(["node", "tests/e2e/evo_state.mjs", *ids]))


def ingest(tmdb, quality="720p"):
    return app("POST", "/api/evo/ingest", {"tmdbId": tmdb, "mediaType": "movie", "quality": quality})


def engines_view():
    return {e["id"]: e for e in app("GET", "/api/admin/evo/engines")[1]["engines"]}


def wait(pred, timeout=30, step=1):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = pred()
        except Exception:
            v = None
        if v:
            return v
        time.sleep(step)
    return None


app_proc = None
try:
    start_engine(A)
    start_engine(B)
    app_proc = subprocess.Popen(["pnpm", "dev"], env={**os.environ, "EVO_ENGINES": f'["http://127.0.0.1:8001","http://127.0.0.1:8002"]'}, stdout=open(f"{work}/app.log", "w"), stderr=subprocess.STDOUT, start_new_session=True)
    wait(lambda: urllib.request.urlopen(BASE + "/login", timeout=3).status == 200, 90)

    # Setup: four titles, so both engines own tasks.
    first = [ingest(t) for t in (862, 603, 550, 13)]
    ids = [r[1]["task_id"] for r in first]
    own = owners(ids)
    on_b = [t for t, e in own.items() if e == B]
    on_a = [t for t, e in own.items() if e == A]
    check(bool(on_a) and bool(on_b), f"setup: both engines own tasks ({len(on_a)} on A, {len(on_b)} on B)")
    tb = on_b[0]
    time.sleep(12)  # let queued jobs finish

    # 1. Engine B stops: no new jobs go to it within one health-check interval.
    stop_engine(B)
    time.sleep(11)
    fresh = [ingest(t) for t in (155, 105)]
    fresh_ids = [r[1]["task_id"] for r in fresh if r[0] == 200]
    fo = owners(fresh_ids)
    check(len(fresh_ids) == 2 and all(e == A for e in fo.values()), f"new jobs avoid the stopped engine: {list(fo.values())}")
    view = engines_view()
    check(view[B]["available"] is False and view[A]["available"] is True, "admin overview shows B unavailable, A available")
    check(view[B]["lastOkAt"] is not None, "...with its last good health check time kept")

    # 2. Tasks owned by B keep their owner and report a clear state.
    code, st = app("GET", f"/api/evo/status/{tb}")
    check(code == 503 and st.get("code") == "ENGINE_UNAVAILABLE", f"status of B's task says the engine is unavailable ({code} {st.get('code')})")
    check(owners([tb])[tb] == B, "B's task still belongs to B (not silently moved)")

    # 3. Controlled retry on another engine.
    code, mv = app("POST", f"/api/admin/evo/tasks/{tb}/move")
    new_tb = mv.get("taskId")
    check(code == 200 and new_tb and new_tb != tb, f"retry elsewhere creates a new task ({code})")
    no = owners([tb, new_tb])
    check(no[new_tb] == A and no[tb] == B, f"new task is on A, the old one stays on B: {no}")
    wait(lambda: app("GET", f"/api/evo/status/{new_tb}")[1].get("status") == "COMPLETED", 30)
    code, st2 = app("GET", f"/api/evo/status/{new_tb}")
    check(st2.get("status") == "COMPLETED", f"the retried job completes on A ({st2.get('status')})")

    # 4. Recovery: B returns and receives new work again without intervention.
    start_engine(B)
    time.sleep(11)
    more = [ingest(t) for t in (424, 122)]
    mo = owners([r[1]["task_id"] for r in more if r[0] == 200])
    check(B in mo.values(), f"recovered engine gets new jobs again: {list(mo.values())}")
    check(engines_view()[B]["available"] is True, "overview shows B available again")

    # 5. Draining A: no new jobs, its active ones finish, then it is safe to remove.
    a_active = [t for t, e in owners([r[1]["task_id"] for r in more if r[0] == 200]).items() if e == A]
    code, _ = app("PATCH", f"/api/admin/evo/engines/{A}", {"draining": True})
    check(code == 200, "A is marked draining")
    drained = [ingest(t) for t in (278, 497)]
    do = owners([r[1]["task_id"] for r in drained if r[0] == 200])
    check(len(do) == 2 and all(e == B for e in do.values()), f"a draining engine receives no new jobs: {list(do.values())} (HTTP {[r[0] for r in drained]})")
    safe = wait(lambda: engines_view()[A]["safeToRemove"], 40)
    check(bool(safe), "A is shown as safe to remove once its work is done")
    done = [app("GET", f"/api/evo/status/{t}")[1].get("status") for t in a_active]
    check(all(s in ("COMPLETED", "STREAMING") for s in done), f"A finished the jobs it already had: {done}")
    app("PATCH", f"/api/admin/evo/engines/{A}", {"draining": False})
    check(engines_view()[A]["draining"] is False, "A can be returned to rotation")
finally:
    for e in list(procs):
        stop_engine(e)
    if app_proc:
        os.killpg(app_proc.pid, signal.SIGTERM)
print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if results and all(results) else 1)
