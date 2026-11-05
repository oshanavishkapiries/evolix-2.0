# Local Docker Development Environment

This guide describes the local Docker development environment for `evolix-2.0`, which provides a local PostgreSQL database, a Neon-compatible HTTP proxy, and a local Evo media engine.

## Architecture & Ports

The local development stack (`compose.dev.yaml`) exposes services bound exclusively to loopback (`127.0.0.1`):

| Service | Container Port | Host Port | Purpose |
|---------|---------------|-----------|---------|
| `postgres` | `5432` | `127.0.0.1:54329` | Pinned PostgreSQL 17 database storing all local application data in named volume `postgres-data`. |
| `neon-proxy` | `4444` | `127.0.0.1:4444` | `ghcr.io/timowilhelm/local-neon-http-proxy` translating Neon HTTP/Serverless queries from `@neondatabase/serverless` to standard PostgreSQL TCP queries. |
| `evo-engine` | `8000` | `127.0.0.1:8000` | Local Evo media extraction and transcoding engine, built from `./evo-engine` with `host.docker.internal` host gateway mapping. |

## Quick Start Commands

Use `scripts/dev-local.sh` or npm scripts:

```bash
# 1. Start the stack (postgres + neon-proxy + evo-engine) and wait for healthchecks:
./scripts/dev-local.sh up
# or: npm run dev:local:up

# 2. Apply all Drizzle migrations to the local database:
./scripts/dev-local.sh migrate
# or: npm run dev:local:migrate

# 3. Verify health and connectivity end-to-end:
./scripts/dev-local.sh check
# or: npm run dev:local:check

# 4. View container status:
./scripts/dev-local.sh status

# 5. Tail container logs:
./scripts/dev-local.sh logs [optional_service_name]

# 6. Stop the stack:
./scripts/dev-local.sh down
# or: npm run dev:local:down

# 7. Reset / wipe local database and engine volumes:
./scripts/dev-local.sh reset
```

## How to Switch Next.js Dev Server to Local

Use a single root `.env` file for the main application. Copy `.env.example` to `.env` on first setup, fill the required bootstrap credentials, and set the local connection values below. Admin-managed database values override these environment fallbacks. Do not create `.env.local`, which would silently override `.env`.

1. Update `.env` with the local database URL and engine endpoints:
   - `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/evolix_local`
   - `EVO_ENGINES=["http://127.0.0.1:8000"]`
   - `DEV_LOG_OTP=true`
   - `APP_URL=http://localhost:3000`
2. Stop any currently running `next dev` instance on port 3000 (`Ctrl+C` or kill its process).
3. Start the Next.js dev server:
   ```bash
   npm run dev
   ```
   Next.js will output `Environments: .env`. The application's `db` module detects the local `DATABASE_URL` host (`127.0.0.1`) and automatically routes `@neondatabase/serverless` HTTP requests through `http://127.0.0.1:4444/sql`.
4. **To switch back to production Neon**:
   Change `DATABASE_URL` in `.env` to the intended Neon connection string, update engine endpoints as needed, and restart `npm run dev`. When `DATABASE_URL` targets remote Neon cloud, driver behavior remains byte-for-byte untouched.

## Database Migrations

- Migrations are defined in `./drizzle`.
- To apply newly added migrations from concurrent branches, run:
  ```bash
  npm run dev:local:migrate
  ```
  The script validates that the target database host is strictly local (`127.0.0.1` / `localhost`) before applying migrations and will refuse to execute against remote hosts.

## Testing

Run unit tests for the local database URL detection and proxy configuration:
```bash
npm run test:db-url
```
