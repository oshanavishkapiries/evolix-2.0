#!/usr/bin/env bash
# Failure / retry / recovery / draining scenarios with two stub engines (ports 8001, 8002; the app on 3000).
set -u
cd "$(dirname "$0")/../.."
TITLES="862 603 550 13 155 105 424 122 278 497"
node tests/e2e/evo_db.mjs guard $TITLES || exit 1
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
read -r SID TOKEN < <(node tests/e2e/session.mjs create)
trap 'node tests/e2e/session.mjs delete "$SID"; node tests/e2e/evo_db.mjs cleanup "$START"' EXIT
SEC=$(grep -m1 '^EVO_SECRET_TOKEN' .env | sed 's/^[^=]*=//; s/^"//; s/"\s*$//; s/\r$//')
EVO_SECRET_TOKEN="$SEC" E2E_ACCESS_TOKEN="$TOKEN" evo-engine/test/.venv/bin/python tests/e2e/engine_failure.py
