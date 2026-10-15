#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

export PYTHONPATH="$DIR"
echo "Starting Evo-Engine microservice on http://0.0.0.0:8000 ..."
exec "$DIR/test/.venv/bin/uvicorn" app.main:app --host 0.0.0.0 --port 8000
