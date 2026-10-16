#!/usr/bin/env bash
# Runs the player e2e checks against a running production server (BASE_URL, default http://localhost:3000).
# Mints a throwaway session, runs the Python/Playwright script from the engine venv, then removes the session and
# the source-less catalog row the watch page creates for TMDB 680.
set -u
cd "$(dirname "$0")/../.."
read -r SID TOKEN < <(node tests/e2e/session.mjs create)
trap 'node tests/e2e/session.mjs delete "$SID"' EXIT
E2E_ACCESS_TOKEN="$TOKEN" tools/evo-engine/test/.venv/bin/python tests/e2e/sinhala_subtitles.py
