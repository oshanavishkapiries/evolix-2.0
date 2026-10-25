#!/usr/bin/env bash
# Starts two stub engines and an app wired to both, runs multi_engine.py, then stops them.
# Needs the engine venv, a built or dev-capable app (pnpm dev), a real TMDB key and the app's .env. Ports 8001, 8002, 3000 must be free.
set -u
cd "$(dirname "$0")/../.."
TITLES="862 603 550 13 238 11"
node tests/e2e/evo_db.mjs guard $TITLES || exit 1
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
W=$(mktemp -d)
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; node tests/e2e/evo_db.mjs cleanup "$START"; node tests/e2e/session.mjs delete "$SID" 2>/dev/null; rm -rf "$W"; }
trap cleanup EXIT
for n in 1 2; do
  mkdir -p "$W/e$n/dl" "$W/e$n/tmp"
  (cd evo-engine && PYTHONPATH=. SQLITE_DB_PATH="$W/e$n/db.sqlite3" DOWNLOAD_DIR="$W/e$n/dl" TEMP_DIR="$W/e$n/tmp" STUB_EXTRACT_SECONDS=2 MAX_CONCURRENT_EXTRACTIONS=1 MIN_FREE_DISK_GB=1 \
    exec test/.venv/bin/python -m uvicorn stub_engine:app --host 127.0.0.1 --port 800$n > "$W/e$n.log" 2>&1) &
  PIDS+=($!)
done
(EVO_ENGINES='["http://127.0.0.1:8001","http://127.0.0.1:8002"]' exec pnpm dev > "$W/app.log" 2>&1) &
PIDS+=($!)
for i in $(seq 40); do curl -sf localhost:3000/login >/dev/null && curl -sf localhost:8001/health >/dev/null && curl -sf localhost:8002/health >/dev/null && break; sleep 1; done
SEC=$(grep -m1 '^EVO_SECRET_TOKEN' .env | sed 's/^[^=]*=//; s/^"//; s/"\s*$//; s/\r$//')
read -r SID TOKEN < <(node tests/e2e/session.mjs create)
mkdir -p "$W/e1" "$W/e2"; ln -sf "$W/e1.log" "$W/e1/log"; ln -sf "$W/e2.log" "$W/e2/log"
E2E_LOG_DIR="$W" EVO_SECRET_TOKEN="$SEC" E2E_ACCESS_TOKEN="$TOKEN" evo-engine/test/.venv/bin/python tests/e2e/multi_engine.py
