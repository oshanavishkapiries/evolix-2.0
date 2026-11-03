#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="compose.dev.yaml"

get_target_database_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    echo "$DATABASE_URL"
    return 0
  fi
  if [ -f ".env.local" ]; then
    node -e '
      const fs = require("fs");
      const content = fs.readFileSync(".env.local", "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx !== -1 && trimmed.slice(0, idx).trim() === "DATABASE_URL") {
          let val = trimmed.slice(idx + 1).trim();
          if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("\x27") && val.endsWith("\x27"))) {
            val = val.slice(1, -1);
          }
          console.log(val);
          process.exit(0);
        }
      }
      process.exit(1);
    '
    return $?
  fi
  return 1
}

get_url_host() {
  local url="$1"
  node -e '
    const urlStr = process.argv[1];
    try {
      const u = new URL(urlStr);
      console.log(u.hostname);
    } catch (e) {
      process.exit(1);
    }
  ' "$url"
}

is_local_host() {
  local host="$1"
  case "$host" in
    localhost|127.0.0.1|::1|\[::1\]|postgres|host.docker.internal|*.localhost|*.localtest.me)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

cmd_up() {
  echo "Starting local development stack (${COMPOSE_FILE})..."
  docker compose -f "$COMPOSE_FILE" up -d --build --wait --wait-timeout 60
  echo "Local development stack is healthy and ready."
  docker compose -f "$COMPOSE_FILE" ps
}

cmd_down() {
  echo "Stopping local development stack..."
  docker compose -f "$COMPOSE_FILE" down
  echo "Local development stack stopped."
}

cmd_migrate() {
  local target_url
  target_url=$(get_target_database_url) || {
    echo "ERROR: DATABASE_URL not found in environment or .env.local" >&2
    exit 1
  }

  local target_host
  target_host=$(get_url_host "$target_url") || {
    echo "ERROR: Could not parse database host from URL" >&2
    exit 1
  }

  if ! is_local_host "$target_host"; then
    echo "ERROR: Target database host '$target_host' is NOT local!" >&2
    echo "Refusing to run migrations against non-local host." >&2
    exit 1
  fi

  echo "Target database host: $target_host (local)"
  echo "Applying Drizzle migrations to local database..."
  DATABASE_URL="$target_url" npx tsx -e '
    import { db } from "./db";
    import { migrate } from "drizzle-orm/neon-http/migrator";

    async function run() {
      await migrate(db, { migrationsFolder: "./drizzle" });
      console.log("Migrations applied successfully.");
    }
    run().catch(err => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
  '
}

cmd_reset() {
  echo "WARNING: This will stop local containers and DROP all persistent development volumes."
  read -r -p "Are you sure you want to drop all local development volumes? [y/N] " confirm
  case "$confirm" in
    [yY]|[yY][eE][sS])
      echo "Resetting local development environment (dropping volumes)..."
      docker compose -f "$COMPOSE_FILE" down -v
      echo "Reset complete."
      ;;
    *)
      echo "Reset aborted."
      ;;
  esac
}

cmd_status() {
  docker compose -f "$COMPOSE_FILE" ps
}

cmd_logs() {
  docker compose -f "$COMPOSE_FILE" logs -f "$@"
}

cmd_check() {
  echo "=== Running local development health checks ==="
  echo ""

  echo "1. Checking Docker Compose services status..."
  docker compose -f "$COMPOSE_FILE" ps
  echo ""

  echo "2. Checking Evo Engine health endpoint..."
  local engine_health
  engine_health=$(curl -s -f http://127.0.0.1:8000/health)
  echo "Engine health response: $engine_health"
  echo ""

  echo "3. Checking Postgres tables via docker exec psql..."
  local table_count
  table_count=$(docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres -d evolix_local -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name != '__drizzle_migrations';")
  echo "Public tables in local database: $table_count"
  docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres -d evolix_local -t -A -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name != '__drizzle_migrations' ORDER BY table_name;"
  echo ""

  echo "4. Testing application 'db' module via local Neon HTTP proxy..."
  npx tsx scripts/check-local-db.ts
  echo ""
  echo "=== All local checks passed successfully ==="
}

usage() {
  echo "Usage: $0 {up|down|migrate|reset|status|logs|check}"
  echo ""
  echo "Commands:"
  echo "  up       Start local stack (postgres, neon-proxy, evo-engine) and wait for healthy"
  echo "  down     Stop local stack"
  echo "  migrate  Apply Drizzle migrations to local database (local host only)"
  echo "  reset    Drop local containers and data volumes (with confirmation)"
  echo "  status   Show status of local stack containers"
  echo "  logs     Follow logs of local stack containers"
  echo "  check    Run end-to-end verification of local services and db connection"
  exit 1
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  migrate) cmd_migrate ;;
  reset) cmd_reset ;;
  status) cmd_status ;;
  logs) shift; cmd_logs "$@" ;;
  check) cmd_check ;;
  *) usage ;;
esac
