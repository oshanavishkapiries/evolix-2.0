#!/usr/bin/env bash
# Two app processes race to claim the same job key against two stub engines: exactly one engine must come out.
set -u
cd "$(dirname "$0")/../.."
W=$(mktemp -d); PIDS=()
trap 'for p in "${PIDS[@]}"; do kill $p 2>/dev/null; done; rm -rf "$W"' EXIT
for n in 1 2; do
  mkdir -p "$W/e$n/dl" "$W/e$n/tmp"
  (cd evo-engine && PYTHONPATH=. SQLITE_DB_PATH="$W/e$n/db.sqlite3" DOWNLOAD_DIR="$W/e$n/dl" TEMP_DIR="$W/e$n/tmp" MIN_FREE_DISK_GB=1 exec test/.venv/bin/python -m uvicorn stub_engine:app --host 127.0.0.1 --port 800$n > "$W/e$n.log" 2>&1) &
  PIDS+=($!)
done
for i in $(seq 30); do curl -sf localhost:8001/health >/dev/null && curl -sf localhost:8002/health >/dev/null && break; sleep 1; done
KEY="claimtest:$(date +%s%N)"
export EVO_ENGINES='["http://127.0.0.1:8001","http://127.0.0.1:8002"]'
npx tsx --env-file=.env tests/e2e/claims.ts "$KEY" > "$W/a.out" & A=$!
npx tsx --env-file=.env tests/e2e/claims.ts "$KEY" > "$W/b.out" & B=$!
wait $A $B
echo "process A: $(cat "$W/a.out")  process B: $(cat "$W/b.out")"
ONE=$(cat "$W/a.out" "$W/b.out" | python3 -c "import sys,json; s=set(); [s.update(json.loads(l)) for l in sys.stdin]; print(len(s))")
node -e "
const {neon}=require('@neondatabase/serverless');const fs=require('fs');
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^[\"']|[\"']\$/g,'')]}));
neon(env.DATABASE_URL).query(\"delete from evo_claims where key like 'claimtest:%'\").then(()=>0)" 2>/dev/null
[ "$ONE" = "1" ] && echo "PASS: 50 concurrent claims from two processes all got the same engine" || { echo "FAIL: $ONE different engines"; exit 1; }
